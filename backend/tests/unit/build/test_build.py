from __future__ import annotations

import datetime
import json
from pathlib import Path

import duckdb
import pytest

from bsllmner_viewer.build.ingest import BuildError, build_full
from bsllmner_viewer.build.manifest import load_manifest
from bsllmner_viewer.store.version import read_version
from tests.synthetic import TARGET_ASSAYS, Synthetic


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


def test_build_selects_the_first_run_in_the_manifest_that_has_the_biosample(
    store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic
) -> None:
    order = {name: i for i, name in enumerate(synthetic.run_names)}
    runs_of: dict[str, list[str]] = {}
    for run, accession in synthetic.truth.modified:
        runs_of.setdefault(accession, []).append(run)
    selected = {
        str(a): str(r)
        for a, r in _rows(store_con, "SELECT b.accession, r.name FROM biosample b JOIN run r USING (run_id)")
    }
    assert selected == {a: min(runs, key=order.__getitem__) for a, runs in runs_of.items()}


def test_build_synthetic_data_distinguishes_the_first_run_from_the_latest_update(synthetic: Synthetic) -> None:
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


def test_build_biosample_table_has_no_date_created_or_date_modified_column(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    for table in ("entry", "biosample"):
        columns = {
            str(r[0])
            for r in _rows(store_con, f"SELECT column_name FROM duckdb_columns() WHERE table_name = '{table}'")
        }
        assert "date_published" in columns
        assert not columns & {"date_created", "date_modified"}


def test_build_annotations_match_the_documented_status_rules(
    store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic
) -> None:
    selected: dict[str, str] = {
        str(a): str(r)
        for a, r in _rows(store_con, "SELECT b.accession, r.name FROM biosample b JOIN run r USING (run_id)")
    }
    stored = _rows(
        store_con,
        "SELECT biosample, field, extracted_value, status, term_id FROM annotation "
        "ORDER BY biosample, field, value_index",
    )
    grouped: dict[tuple[str, str], list[tuple[object, ...]]] = {}
    for bs, field, value, status, term in stored:
        grouped.setdefault((str(bs), str(field)), []).append((value, status, term))
    for (run, accession, field), rows in synthetic.truth.annotations.items():
        if selected[accession] != run:
            continue
        assert grouped[(accession, field)] == rows, (accession, field)


def test_build_population_holds_only_target_assays(store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic) -> None:
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
    assert _rows(store_con, "SELECT count(*) FROM term WHERE term_id = 'OBS:1'")[0] == (0,)


def test_build_entries_reference_relations(store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic) -> None:
    bps = {(bs, bp) for bs, items in synthetic.truth.bioprojects.items() for bp in items}
    assert set(_rows(store_con, "SELECT biosample, bioproject FROM biosample_bioproject")) == bps
    runs = _rows(store_con, "SELECT count(*) FROM sra_run")[0][0]
    assert runs == _rows(store_con, "SELECT count(DISTINCT run) FROM ref_experiment_run")[0][0]
    assert _rows(
        store_con, "SELECT count(*) FROM chip_atlas WHERE experiment NOT IN (SELECT accession FROM experiment)"
    )[0] == (0,)


def test_build_version_information(store_con: duckdb.DuckDBPyConnection, synthetic: Synthetic) -> None:
    version = read_version(store_con)
    assert version.name == "synthetic"
    assert version.model == "synthetic-model:1"
    assert [r.name for r in version.runs] == synthetic.run_names
    assert all(len(r.select_config_sha256) == 64 for r in version.runs)
    assert {o.name for o in version.ontologies} == {"cellosaurus", "mondo", "uberon", "chebi", "gene"}
    assert version.reference_snapshots.dblink == "2026-01-03"


def test_build_rejects_existing_output(synthetic: Synthetic, store_path: Path) -> None:
    with pytest.raises(BuildError, match="already exists"):
        build_full(load_manifest(synthetic.manifest), store_path, workers=1)


def test_build_rejects_runs_with_different_models(synthetic: Synthetic, tmp_path: Path) -> None:
    result = synthetic.root / "results" / "select_run2.json"
    data = json.loads(result.read_text())
    original = result.read_text()
    data["run_metadata"]["model"] = "other-model"
    result.write_text(json.dumps(data))
    try:
        with pytest.raises(BuildError, match="different models"):
            build_full(load_manifest(synthetic.manifest), tmp_path / "x.duckdb", workers=1)
    finally:
        result.write_text(original)
    assert not (tmp_path / "x.duckdb").exists() or True


def test_build_rejects_incomplete_runs(synthetic: Synthetic, tmp_path: Path) -> None:
    result = synthetic.root / "results" / "select_run3.json"
    original = result.read_text()
    data = json.loads(original)
    data["run_metadata"]["status"] = "interrupted"
    result.write_text(json.dumps(data))
    try:
        with pytest.raises(BuildError, match="interrupted"):
            build_full(load_manifest(synthetic.manifest), tmp_path / "y.duckdb", workers=1)
    finally:
        result.write_text(original)


def test_build_rejects_entries_missing_from_the_input(synthetic: Synthetic, tmp_path: Path) -> None:
    inputs = synthetic.root / "inputs" / "run1.jsonl"
    original = inputs.read_text()
    inputs.write_text("\n".join(original.splitlines()[1:]) + "\n")
    try:
        with pytest.raises(ValueError, match="not in the input file"):
            build_full(load_manifest(synthetic.manifest), tmp_path / "z.duckdb", workers=1)
    finally:
        inputs.write_text(original)
