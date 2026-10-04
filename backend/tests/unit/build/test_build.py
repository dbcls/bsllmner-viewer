from __future__ import annotations

import datetime
import hashlib
import json
import re
from pathlib import Path

import duckdb
import pytest

from bsllmner_viewer.build.errors import BuildError
from bsllmner_viewer.build.evidence import ONTOLOGY_SYNONYM, Text, trace, trace_term
from bsllmner_viewer.build.ingest import build_full
from bsllmner_viewer.build.manifest import load_manifest
from bsllmner_viewer.build.mk2_filter_keys import MK2_FILTER_KEYS
from bsllmner_viewer.store.metadata import ATTRIBUTE, DESCRIPTION, RECORD, description_items
from bsllmner_viewer.store.version import read_version
from tests.synthetic import TARGET_ASSAYS, Synthetic, generate


def _rows(con: duckdb.DuckDBPyConnection, sql: str, *params: object) -> list[tuple[object, ...]]:
    return con.execute(sql, list(params)).fetchall()


def test_build_stores_exactly_one_selected_run_per_biosample(
    store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic
) -> None:
    assert (
        _rows(store_con, "SELECT count(*), count(DISTINCT accession) FROM biosample")[0]
        == (len(synthetic.accessions),) * 2
    )
    assert _rows(store_con, "SELECT count(*) FROM entry WHERE accession NOT IN (SELECT accession FROM biosample)")[
        0
    ] == (0,)


def _omitted(con: duckdb.DuckDBPyConnection) -> set[str]:
    return {str(r[0]) for r in _rows(con, "SELECT name FROM omitted_attribute")}


def test_derivation_omits_exactly_the_mk2_filter_keys_that_no_evidence_points_to(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    attributes = {
        str(a): json.loads(str(raw)) for a, raw in _rows(store_con, "SELECT accession, attributes FROM biosample")
    }
    held = {
        attributes[str(biosample)][int(str(item))]["name"]
        for biosample, item in _rows(store_con, "SELECT biosample, item FROM evidence WHERE kind = ?", ATTRIBUTE)
    }
    assert "study disease" in held
    assert _omitted(store_con) == MK2_FILTER_KEYS - held
    assert "GEO Accession" in _omitted(store_con)


def test_derived_biosample_leaves_out_the_omitted_attributes_in_order_and_the_entry_keeps_them(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    omitted = _omitted(store_con)
    rows = _rows(
        store_con,
        "SELECT b.attributes, e.attributes FROM biosample b JOIN entry e USING (accession, run_id)",
    )
    assert rows
    kept_somewhere = False
    for derived, raw in rows:
        raw_list = json.loads(str(raw))
        assert json.loads(str(derived)) == [a for a in raw_list if a["name"] not in omitted]
        kept_somewhere |= any(a["name"] in omitted for a in raw_list)
    assert kept_somewhere


def test_synthetic_dataset_has_a_biosample_whose_latest_update_is_not_in_its_first_run(synthetic: Synthetic) -> None:
    order = {name: i for i, name in enumerate(synthetic.run_names)}
    runs_of: dict[str, list[str]] = {}
    for run, accession in synthetic.truth.modified:
        runs_of.setdefault(accession, []).append(run)
    shared = {a: sorted(r, key=order.__getitem__) for a, r in runs_of.items() if len(r) > 1}
    assert shared
    modified = synthetic.truth.modified
    assert any(max(runs, key=lambda run: modified[(run, accession)]) != runs[0] for accession, runs in shared.items())


def test_build_date_published_is_the_publication_date_in_utc_of_the_selected_run(
    store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic
) -> None:
    stored = {
        str(a): (str(r), d)
        for a, r, d in _rows(
            store_con, "SELECT b.accession, r.name, b.date_published FROM biosample b JOIN run r USING (run_id)"
        )
    }
    assert stored
    assert any(d is None for _, d in stored.values())
    assert any(d is not None for _, d in stored.values())
    for accession, (run, date) in stored.items():
        assert date == synthetic.truth.published[(run, accession)], accession


def test_build_publication_dates_before_2005_or_after_the_run_start_are_unknown(
    store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic
) -> None:
    stored = {
        (str(r), str(a)): d
        for a, r, d in _rows(
            store_con, "SELECT b.accession, r.name, b.date_published FROM biosample b JOIN run r USING (run_id)"
        )
    }
    early = [k for k in stored if (d := synthetic.truth.published_input[k]) and d < datetime.date(2005, 1, 1)]
    late = [k for k in stored if (d := synthetic.truth.published_input[k]) and d > datetime.date(2026, 1, 1)]
    bounds = [
        k
        for k in stored
        if synthetic.truth.published_input[k] in (datetime.date(2005, 1, 1), datetime.date(2026, 1, 1))
    ]
    assert early, "the generator must produce publication dates before 2005"
    assert late, "the generator must produce publication dates after the run start"
    assert bounds, "the generator must produce publication dates on the bounds"
    assert all(stored[k] is None for k in [*early, *late])
    assert all(stored[k] == synthetic.truth.published_input[k] for k in bounds)


def test_build_entry_and_biosample_tables_have_date_published_and_no_date_created_or_date_modified(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    for table in ("entry", "biosample"):
        columns = {
            str(r[0])
            for r in _rows(store_con, f"SELECT column_name FROM duckdb_columns() WHERE table_name = '{table}'")
        }
        assert "date_published" in columns
        assert not columns & {"date_created", "date_modified"}


def test_build_population_holds_only_target_assays_and_the_biosample_table_keeps_the_other_biosamples(
    store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic
) -> None:
    expected = {
        (bs, srx) for bs, exps in synthetic.truth.experiments.items() for srx, assay in exps if assay in TARGET_ASSAYS
    }
    assert set(_rows(store_con, "SELECT biosample, experiment FROM population")) == expected
    kept = _rows(
        store_con,
        "SELECT count(*) FROM biosample WHERE accession NOT IN (SELECT biosample FROM population)",
    )[0][0]
    assert kept == sum(
        1 for bs, exps in synthetic.truth.experiments.items() if not any(a in TARGET_ASSAYS for _, a in exps)
    )


def test_build_closure_includes_self_and_all_paths(store_con: duckdb.DuckDBPyConnection) -> None:
    ancestors = {r[0] for r in _rows(store_con, "SELECT ancestor FROM term_closure WHERE descendant = 'MONDO:0004989'")}
    assert ancestors == {"MONDO:0004989", "MONDO:0007254", "MONDO:0004992", "MONDO:0002657", "MONDO:0000001"}


def test_build_leaves_out_obsolete_terms(store_con: duckdb.DuckDBPyConnection) -> None:
    assert _rows(store_con, "SELECT count(*) FROM term WHERE term_id = 'OBS:1'")[0] == (0,)


def test_build_closure_follows_part_of_relations(store_con: duckdb.DuckDBPyConnection) -> None:
    for term_id in ("UBERON:0000178", "UBERON:0003661"):
        ancestors = {
            r[0] for r in _rows(store_con, f"SELECT ancestor FROM term_closure WHERE descendant = '{term_id}'")
        }
        assert ancestors == {term_id, "UBERON:0000061"}


def test_build_relation_tables_agree_with_the_reference_data(
    store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic
) -> None:
    bps = {(bs, bp) for bs, items in synthetic.truth.bioprojects.items() for bp in items}
    assert set(_rows(store_con, "SELECT biosample, bioproject FROM biosample_bioproject")) == bps
    reference = synthetic.root / "reference"
    experiments = {str(r[0]) for r in _rows(store_con, "SELECT accession FROM experiment")}
    assert experiments

    dblink = duckdb.connect(str(reference / "dblink.duckdb"), read_only=True)
    try:
        links = _rows(
            dblink,
            "SELECT linked_accession, accession FROM dbxref "
            "WHERE accession_type = 'sra-experiment' AND linked_type = 'sra-run'",
        )
    finally:
        dblink.close()
    expected_runs = {(str(run), str(srx)) for run, srx in links if srx in experiments}
    stored_runs = set(_rows(store_con, "SELECT accession, experiment FROM sra_run"))
    assert expected_runs
    assert len({srx for _, srx in expected_runs}) > 1
    assert stored_runs == expected_runs

    chip = {
        (cells[0], cells[1])
        for line in (reference / "experimentList.tab").read_text().splitlines()
        if line and (cells := line.split("\t"))[0] in experiments
    }
    assert chip
    assert set(_rows(store_con, "SELECT experiment, assembly FROM chip_atlas")) == chip

    titles: dict[str, str | None] = {}
    for file in sorted((reference / "bioproject").glob("*.jsonl")):
        for line in file.read_text().splitlines():
            row = json.loads(line)
            titles[row["identifier"]] = row.get("title")
    stored: dict[object, object] = dict(_rows(store_con, "SELECT accession, title FROM bioproject"))  # type: ignore[arg-type]
    assert stored
    assert stored == {bp: titles[bp] for _, bp in bps}
    assert any(title for title in stored.values())


def test_build_version_records_the_manifest_the_model_the_runs_the_ontologies_and_the_snapshots(
    store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic
) -> None:
    version = read_version(store_con)
    assert version.name == "synthetic"
    assert version.model == "synthetic-model:1"
    assert [r.name for r in version.runs] == synthetic.run_names
    config_sha = hashlib.sha256((synthetic.root / "config" / "select-config.json").read_bytes()).hexdigest()
    assert all(r.mk2_version == "abc1234" for r in version.runs)
    assert all(r.select_config_sha256 == config_sha for r in version.runs)
    assert {o.name for o in version.ontologies} == {"cellosaurus", "mondo", "uberon", "chebi", "gene"}
    for ontology in version.ontologies:
        file = synthetic.root / "ontology" / f"{ontology.name}.obo"
        assert ontology.checksums == [hashlib.sha256(file.read_bytes()).hexdigest()], ontology.name
        assert ontology.snapshot_date == "2026-01-01"
    assert len({o.checksums[0] for o in version.ontologies}) == len(version.ontologies)
    assert version.target_assays == list(TARGET_ASSAYS)
    snapshots = version.reference_snapshots
    assert (snapshots.sra_experiments, snapshots.dblink, snapshots.bioprojects, snapshots.chip_atlas) == (
        "2026-01-02",
        "2026-01-03",
        "2026-01-04",
        "2026-01-05",
    )
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", version.created_at)
    created = datetime.datetime.fromisoformat(version.created_at.removesuffix("Z"))
    assert abs(datetime.datetime.now(datetime.UTC).replace(tzinfo=None) - created) < datetime.timedelta(days=1)


def test_build_rejects_existing_output(synthetic: Synthetic, store_path: Path) -> None:
    with pytest.raises(BuildError, match="already exists"):
        build_full(load_manifest(synthetic.manifest), store_path, workers=1)


def test_entry_keeps_exactly_the_record_items_that_its_evidence_points_to(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    pointed: dict[tuple[int, str], set[int]] = {}
    for run_id, accession, item in store_con.execute(
        "SELECT run_id, accession, item FROM entry_evidence WHERE kind = ?", [RECORD]
    ).fetchall():
        pointed.setdefault((run_id, accession), set()).add(item)
    kept = owners = 0
    for run_id, accession, record in store_con.execute("SELECT run_id, accession, record FROM entry").fetchall():
        items = json.loads(record)
        assert pointed.get((run_id, accession), set()) == set(range(len(items)))
        assert not any(item["path"].startswith("Owner.Contacts") for item in items)
        kept += len(items)
        owners += any(item["path"] == "Owner.Name" for item in items)
    assert kept > 0
    assert owners > 0


def _names_of_terms(con: duckdb.DuckDBPyConnection) -> dict[str, list[str]]:
    names: dict[str, list[str]] = {str(t): [str(label)] for t, label in _rows(con, "SELECT term_id, label FROM term")}
    for term_id, synonym in _rows(con, "SELECT term_id, synonym FROM term_synonym ORDER BY synonym"):
        names[str(term_id)].append(str(synonym))
    return names


def test_evidence_is_the_trace_of_each_extracted_value_over_the_original_metadata_of_its_biosample(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    """The evidence recomputed from the stored metadata equals the stored evidence.

    If the build omitted an item that holds evidence (an omitted attribute, or an item of the record), the
    recomputed evidence would differ from the stored evidence.
    """
    names = _names_of_terms(store_con)
    stored: dict[tuple[str, str, int], set[tuple[object, ...]]] = {}
    for biosample, field, value_index, *piece in _rows(
        store_con,
        "SELECT biosample, field, value_index, kind, item, in_name, span_start, span_end, strategy FROM evidence",
    ):
        stored.setdefault((str(biosample), str(field), int(str(value_index))), set()).add(tuple(piece))
    metadata = {
        str(r[0]): r[1:]
        for r in _rows(store_con, "SELECT accession, title, description, attributes, record FROM biosample")
    }
    traced = with_term = 0
    for biosample, field, value_index, value, term_id, term_label in _rows(
        store_con,
        "SELECT biosample, field, value_index, extracted_value, term_id, term_label FROM annotation "
        "WHERE extracted_value IS NOT NULL",
    ):
        title, description, attributes, record = metadata[str(biosample)]
        described = description_items(
            None if title is None else str(title), ((d["name"], d["value"]) for d in json.loads(str(description)))
        )
        parsed = json.loads(str(attributes))
        values = [((DESCRIPTION, at, False), Text(v)) for at, (_, v) in enumerate(described)]
        values += [((ATTRIBUTE, at, False), Text(a["value"])) for at, a in enumerate(parsed)]
        attribute_names = [((ATTRIBUTE, at, True), Text(a["name"])) for at, a in enumerate(parsed)]
        records = [((RECORD, at, False), Text(r["value"])) for at, r in enumerate(json.loads(str(record)))]
        groups = [values, attribute_names, records]
        expected: set[tuple[object, ...]] = set()
        result = trace(str(value), [[t for _, t in g] for g in groups])
        if result is None and term_id is not None:
            term_names = [
                *names[str(term_id)][:1],
                *([str(term_label)] if term_label else []),
                *names[str(term_id)][1:],
            ]
            result = trace_term(term_names, [[t for _, t in g] for g in groups[:2]])
            with_term += result is not None
        if result is not None:
            for m in result.matches:
                expected.add((*groups[result.group][m.text][0], m.span.start, m.span.end, result.strategy))
        assert stored.get((str(biosample), str(field), int(str(value_index))), set()) == expected, (biosample, field)
        traced += bool(expected)
    assert traced > 0
    assert with_term > 0


def test_all_evidence_of_a_value_has_one_strategy_and_is_in_one_group_and_term_names_are_not_traced_in_the_record(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    rows = _rows(
        store_con,
        "SELECT count(DISTINCT strategy), "
        "count(DISTINCT CASE WHEN kind = 'record' THEN 2 WHEN in_name THEN 1 ELSE 0 END) "
        "FROM evidence GROUP BY biosample, field, value_index",
    )
    assert rows
    assert all(r == (1, 1) for r in rows)
    strategies = {str(r[0]) for r in _rows(store_con, "SELECT DISTINCT strategy FROM evidence")}
    assert {"exact", "normalized", ONTOLOGY_SYNONYM} <= strategies
    assert _rows(
        store_con, "SELECT count(*) FROM evidence WHERE strategy = ? AND kind = ?", ONTOLOGY_SYNONYM, RECORD
    ) == [(0,)]


def test_derived_biosample_carries_the_description_and_record_of_its_selected_entry(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    rows = _rows(
        store_con,
        "SELECT b.description = e.description AND b.record = e.record "
        "FROM biosample b JOIN entry e USING (accession, run_id)",
    )
    assert rows
    assert all(bool(r[0]) for r in rows)
    lists = _rows(store_con, "SELECT description FROM biosample WHERE description::VARCHAR LIKE '%first paragraph%'")
    assert lists


def test_build_closure_with_cycle_through_is_a_and_part_of_terminates(tmp_path: Path) -> None:
    synthetic = generate(tmp_path, seed=2, n_biosamples=20, n_runs=1)
    obo = synthetic.root / "ontology" / "uberon.obo"
    text = obo.read_text()
    text = text.replace(
        "id: UBERON:0002107\nname: liver\n", "id: UBERON:0002107\nname: liver\nrelationship: part_of UBERON:0002048\n"
    ).replace("id: UBERON:0002048\nname: lung\n", "id: UBERON:0002048\nname: lung\nis_a: UBERON:0002107\n")
    obo.write_text(text)
    out = tmp_path / "store" / "cycle.duckdb"
    assert build_full(load_manifest(synthetic.manifest), out, workers=1).ok
    con = duckdb.connect(str(out), read_only=True)
    try:
        rows = _rows(con, "SELECT ancestor FROM term_closure WHERE descendant = 'UBERON:0002107'")
        assert {r[0] for r in rows} == {"UBERON:0002107", "UBERON:0002048", "UBERON:0000061"}
        assert len(rows) == 3
    finally:
        con.close()


def test_build_closure_skips_general_class_inclusion_axioms_and_part_of_across_prefixes(tmp_path: Path) -> None:
    synthetic = generate(tmp_path, seed=2, n_biosamples=20, n_runs=1)
    obo = synthetic.root / "ontology" / "uberon.obo"
    text = obo.read_text()
    text = text.replace(
        "id: UBERON:0000061\nname: anatomical structure\n",
        "id: UBERON:0000061\nname: anatomical structure\n"
        'relationship: part_of UBERON:0002107 {gci_relation="RO:1", gci_filler="GO:1"}\n'
        "relationship: part_of NCBITaxon:6072\n",
    )
    obo.write_text(text)
    out = tmp_path / "store" / "gci.duckdb"
    assert build_full(load_manifest(synthetic.manifest), out, workers=1).ok
    con = duckdb.connect(str(out), read_only=True)
    try:
        rows = _rows(con, "SELECT ancestor FROM term_closure WHERE descendant = 'UBERON:0000061'")
        assert {r[0] for r in rows} == {"UBERON:0000061"}
        rows = _rows(con, "SELECT ancestor FROM term_closure WHERE descendant = 'UBERON:0002107'")
        assert {r[0] for r in rows} == {"UBERON:0002107", "UBERON:0000061"}
    finally:
        con.close()


def _build_in(tmp_path: Path, synthetic: Synthetic) -> duckdb.DuckDBPyConnection:
    out = tmp_path / "store" / "built.duckdb"
    assert build_full(load_manifest(synthetic.manifest), out, workers=1).ok
    return duckdb.connect(str(out), read_only=True)


def test_build_keeps_a_bioproject_without_a_title_with_a_null_title(tmp_path: Path) -> None:
    synthetic = generate(tmp_path, seed=4, n_biosamples=30, n_runs=1)
    file = synthetic.root / "reference" / "bioproject" / "ncbi_1.jsonl"
    docs = [json.loads(line) for line in file.read_text().splitlines()]
    linked = {bp for bps in synthetic.truth.bioprojects.values() for bp in bps}
    untitled = sorted(linked)[0]
    for doc in docs:
        if doc["identifier"] == untitled:
            del doc["title"]
    file.write_text("".join(json.dumps(doc) + "\n" for doc in docs))
    con = _build_in(tmp_path, synthetic)
    try:
        stored: dict[object, object] = dict(_rows(con, "SELECT accession, title FROM bioproject"))  # type: ignore[arg-type]
    finally:
        con.close()
    assert set(stored) == linked
    assert stored[untitled] is None
    assert all(title for bp, title in stored.items() if bp != untitled)


def test_build_full_with_two_files_of_one_ontology_takes_the_terms_of_both_and_the_label_of_the_earlier(
    tmp_path: Path,
) -> None:
    synthetic = generate(tmp_path, seed=2, n_biosamples=20, n_runs=1)
    folder = synthetic.root / "ontology"
    original = (folder / "mondo.obo").read_text()
    (folder / "mondo_a.obo").write_text(
        "format-version: 1.2\n\n"
        "[Term]\nid: MONDO:0004992\nname: cancer of the first file\nis_a: MONDO:0000001 ! disease\n\n"
        "[Term]\nid: MONDO:9000001\nname: only in the first file\nis_a: MONDO:0004992 ! cancer\n\n"
    )
    (folder / "mondo_b.obo").write_text(
        original + "\n[Term]\nid: MONDO:9000002\nname: only in the second file\nis_a: MONDO:0005148 ! diabetes\n"
    )
    manifest = synthetic.manifest.read_text()
    assert "files: [ontology/mondo.obo]" in manifest
    synthetic.manifest.write_text(
        manifest.replace("files: [ontology/mondo.obo]", "files: [ontology/mondo_a.obo, ontology/mondo_b.obo]")
    )
    con = _build_in(tmp_path, synthetic)
    try:
        labels: dict[object, object] = dict(_rows(con, "SELECT term_id, label FROM term WHERE ontology = 'MONDO'"))  # type: ignore[arg-type]
        closure = {
            term: {str(r[0]) for r in _rows(con, "SELECT ancestor FROM term_closure WHERE descendant = ?", term)}
            for term in ("MONDO:9000001", "MONDO:9000002")
        }
    finally:
        con.close()
    assert labels["MONDO:9000001"] == "only in the first file"
    assert labels["MONDO:9000002"] == "only in the second file"
    assert labels["MONDO:0004992"] == "cancer of the first file"
    assert labels["MONDO:0005148"] == "type 2 diabetes mellitus"
    assert closure["MONDO:9000001"] == {"MONDO:9000001", "MONDO:0004992", "MONDO:0000001"}
    assert closure["MONDO:9000002"] == {"MONDO:9000002", "MONDO:0005148", "MONDO:0000001"}


def test_build_traces_a_term_through_the_label_of_the_run_when_it_differs_from_the_ontology_label(
    tmp_path: Path,
) -> None:
    synthetic = generate(tmp_path, seed=3, n_biosamples=30, n_runs=1)
    result_file = synthetic.root / "results" / "select_run1.json"
    result = json.loads(result_file.read_text())
    word = "zorbelquux"
    target: tuple[str, str, str] | None = None
    for entry in result["entries"]:
        for field_name, mapped in entry["results"].items():
            if mapped:
                mapped[0]["label"] = word
                mapped[0]["value"] = "unfindable value"
                extracted = entry["extract"]["extracted"][field_name]
                entry["extract"]["extracted"][field_name] = (
                    ["unfindable value", *extracted[1:]] if isinstance(extracted, list) else "unfindable value"
                )
                target = (entry["extract"]["accession"], field_name, mapped[0]["term_id"])
                break
        if target:
            break
    assert target is not None
    accession, field_name, term_id = target
    result_file.write_text(json.dumps(result))
    input_file = synthetic.root / "inputs" / "run1.jsonl"
    lines = []
    for line in input_file.read_text().splitlines():
        doc = json.loads(line)
        if doc["accession"] == accession:
            body = doc.get("BioSample", doc)
            body["Attributes"]["Attribute"].append({"attribute_name": "note", "content": f"stained with {word} dye"})
        lines.append(json.dumps(doc))
    input_file.write_text("\n".join(lines) + "\n")
    con = _build_in(tmp_path, synthetic)
    try:
        rows = _rows(
            con,
            "SELECT v.kind, v.item, v.span_start, v.span_end, v.strategy, b.attributes FROM evidence v "
            "JOIN biosample b ON b.accession = v.biosample WHERE v.biosample = ? AND v.field = ?",
            accession,
            field_name,
        )
        label = _rows(con, "SELECT label FROM term WHERE term_id = ?", term_id)[0][0]
    finally:
        con.close()
    assert label != word
    traced = [
        json.loads(str(attributes))[int(str(item))]["value"][int(str(start)) : int(str(end))].lower()
        for kind, item, start, end, strategy, attributes in rows
        if strategy == ONTOLOGY_SYNONYM and kind == ATTRIBUTE
    ]
    assert word in traced
