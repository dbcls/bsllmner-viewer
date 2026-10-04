from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
from collections.abc import Callable, Iterator
from pathlib import Path

import duckdb
import pytest
from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.api.store import Store
from bsllmner_viewer.build.cli import main
from bsllmner_viewer.build.errors import BuildError
from bsllmner_viewer.build.evidence import CASE_INSENSITIVE, Text, trace
from bsllmner_viewer.build.ingest import build_append, build_full, build_refresh
from bsllmner_viewer.build.inputs import MAX_TAXONOMY_ID, parse_input_doc, read_input
from bsllmner_viewer.build.manifest import load_manifest
from bsllmner_viewer.build.reference import read_bioprojects, read_experiments
from bsllmner_viewer.build.selectresult import load_select_result, read_entry, read_run_metadata
from bsllmner_viewer.store.schema import SCHEMA_VERSION
from bsllmner_viewer.store.version import read_version
from tests.synthetic import FIELDS, Synthetic, generate


@pytest.fixture
def tiny(tmp_path: Path) -> Synthetic:
    return generate(tmp_path / "syn", seed=3, n_biosamples=12, n_runs=2)


def _doc(**members: object) -> dict[str, object]:
    return {"accession": "S1", **members}


def _drop_first_input_entry(synthetic: Synthetic, run: str = "run1") -> None:
    inputs = synthetic.root / "inputs" / f"{run}.jsonl"
    inputs.write_text("\n".join(inputs.read_text().splitlines()[1:]) + "\n")


def _files(directory: Path) -> list[str]:
    return sorted(p.name for p in directory.iterdir())


def _with_target_assays(synthetic: Synthetic, assays: str) -> None:
    text = synthetic.manifest.read_text()
    synthetic.manifest.write_text(re.sub(r"^target_assays: .*$", f"target_assays: [{assays}]", text, flags=re.M))


def _store_with_failing_verification(synthetic: Synthetic, tmp_path: Path) -> Path:
    _with_target_assays(synthetic, "NoSuchAssay")
    out = tmp_path / "failing" / "store.duckdb"
    assert not build_full(load_manifest(synthetic.manifest), out, workers=1).ok
    return out


# The schema version of the input store of refresh and append.


def _run_operation(operation: str, synthetic: Synthetic, store: Path, out: Path) -> None:
    manifest = load_manifest(synthetic.manifest)
    if operation == "build_refresh":
        build_refresh(manifest, store, out)
        return
    extra = synthetic.manifest_with_runs([*synthetic.run_names, "run_new"], synthetic.root / "append.yaml")
    build_append(load_manifest(extra), store, out, workers=1)


@pytest.mark.parametrize("operation", ["build_append", "build_refresh"])
@pytest.mark.parametrize("version", [SCHEMA_VERSION - 1, SCHEMA_VERSION + 1, "x"])
def test_append_and_refresh_reject_a_store_of_another_schema_version_and_leave_no_file(
    synthetic: Synthetic, store_path: Path, tmp_path: Path, version: object, operation: str
) -> None:
    old = tmp_path / "old.duckdb"
    shutil.copy(store_path, old)
    con = duckdb.connect(str(old))
    con.execute("UPDATE store_meta SET value = ? WHERE key = 'schema_version'", [json.dumps(version)])
    con.close()
    out = tmp_path / "out" / "new.duckdb"
    with pytest.raises(BuildError, match="full build"):
        _run_operation(operation, synthetic, old, out)
    assert not out.exists()
    assert _files(out.parent) == []


@pytest.mark.parametrize("operation", ["build_append", "build_refresh"])
def test_append_and_refresh_reject_a_store_without_a_schema_version(
    synthetic: Synthetic, store_path: Path, tmp_path: Path, operation: str
) -> None:
    old = tmp_path / "old.duckdb"
    shutil.copy(store_path, old)
    con = duckdb.connect(str(old))
    con.execute("DELETE FROM store_meta WHERE key = 'schema_version'")
    con.close()
    out = tmp_path / "new.duckdb"
    with pytest.raises(BuildError, match="full build"):
        _run_operation(operation, synthetic, old, out)
    assert not out.exists()


# A failed build leaves nothing at the output path.


def test_build_full_with_an_entry_missing_from_the_input_leaves_no_file(tiny: Synthetic, tmp_path: Path) -> None:
    _drop_first_input_entry(tiny)
    out = tmp_path / "out" / "store.duckdb"
    with pytest.raises(BuildError, match="not in the input file"):
        build_full(load_manifest(tiny.manifest), out, workers=1)
    assert _files(out.parent) == []


@pytest.mark.parametrize("missing", ["reference/dblink.duckdb", "reference/sra", "ontology/mondo.obo"])
def test_cli_full_with_a_missing_reference_file_reports_it_as_an_error(
    tiny: Synthetic, tmp_path: Path, capsys: pytest.CaptureFixture[str], missing: str
) -> None:
    target = tiny.root / missing
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    out = tmp_path / "out" / "store.duckdb"
    assert main(["full", "--manifest", str(tiny.manifest), "--out", str(out)]) == 1
    err = capsys.readouterr().err
    assert err.startswith("error: "), err
    assert "Traceback" not in err
    assert str(target) in err
    assert not out.parent.exists() or _files(out.parent) == []


def test_build_full_with_a_missing_reference_file_stops_before_it_reads_any_run(
    tiny: Synthetic, tmp_path: Path
) -> None:
    (tiny.root / "reference" / "dblink.duckdb").unlink()
    for result in (tiny.root / "results").iterdir():
        result.write_text("not json")
    out = tmp_path / "out" / "store.duckdb"
    with pytest.raises(BuildError, match=re.escape("dblink.duckdb")):
        build_full(load_manifest(tiny.manifest), out, workers=1)
    assert not out.parent.exists()


def _damage(tiny: Synthetic, damage: str) -> Path:
    if damage == "owl_syntax":
        path = tiny.root / "ontology" / "mondo.owl"
        path.write_text("<rdf:RDF><unclosed>")
        tiny.manifest.write_text(tiny.manifest.read_text().replace("ontology/mondo.obo", "ontology/mondo.owl"))
    elif damage == "obo_encoding":
        path = tiny.root / "ontology" / "mondo.obo"
        path.write_bytes(b"[Term]\nid: MONDO:1\nname: \xff\xfe\n")
    elif damage == "dblink_not_duckdb":
        path = tiny.root / "reference" / "dblink.duckdb"
        path.write_text("not a database")
    else:
        path = tiny.root / "reference" / "dblink.duckdb"
        path.unlink()
        duckdb.connect(str(path)).close()
    return path


@pytest.mark.parametrize("damage", ["owl_syntax", "obo_encoding", "dblink_not_duckdb", "dblink_without_dbxref"])
def test_cli_full_with_reference_data_that_cannot_be_read_names_the_file_in_the_error(
    tiny: Synthetic, tmp_path: Path, capsys: pytest.CaptureFixture[str], damage: str
) -> None:
    path = _damage(tiny, damage)
    out = tmp_path / "out" / "store.duckdb"
    assert main(["full", "--manifest", str(tiny.manifest), "--out", str(out)]) == 1
    err = capsys.readouterr().err
    assert err.startswith("error: "), err
    assert "Traceback" not in err
    assert str(path) in err
    assert _files(out.parent) == []


def test_build_full_when_it_succeeds_leaves_only_the_output(tiny: Synthetic, tmp_path: Path) -> None:
    out = tmp_path / "out" / "store.duckdb"
    assert build_full(load_manifest(tiny.manifest), out, workers=1).ok
    assert _files(out.parent) == ["store.duckdb"]


def _experiment_rows(synthetic: Synthetic) -> tuple[Path, list[dict[str, object]]]:
    path = synthetic.root / "reference" / "sra" / "ncbi_experiment_0001.jsonl"
    return path, [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def test_build_full_with_two_library_strategies_for_one_experiment_stops_and_names_it(
    tiny: Synthetic, tmp_path: Path
) -> None:
    path, rows = _experiment_rows(tiny)
    first = rows[0]
    other = next(a for a in ("RNA-Seq", "ChIP-Seq", "ATAC-seq") if [a] != first["libraryStrategy"])
    with path.open("a") as f:
        f.write(json.dumps({**first, "libraryStrategy": [other]}) + "\n")
    out = tmp_path / "out" / "store.duckdb"
    with pytest.raises(BuildError, match=str(first["identifier"])):
        build_full(load_manifest(tiny.manifest), out, workers=1)
    assert _files(out.parent) == []


def test_build_full_with_the_same_experiment_row_twice_stores_the_experiment_once(
    tiny: Synthetic, tmp_path: Path
) -> None:
    path, rows = _experiment_rows(tiny)
    with path.open("a") as f:
        f.write(json.dumps(rows[0]) + "\n")
    out = tmp_path / "store.duckdb"
    assert build_full(load_manifest(tiny.manifest), out, workers=1).ok
    con = duckdb.connect(str(out), read_only=True)
    try:
        assert con.execute(
            "SELECT count(*), any_value(library_strategy) FROM experiment WHERE accession = ?", [rows[0]["identifier"]]
        ).fetchone() == (1, rows[0]["libraryStrategy"][0])  # type: ignore[index]
    finally:
        con.close()


def test_build_full_with_a_stale_partial_file_removes_it(tiny: Synthetic, tmp_path: Path) -> None:
    out = tmp_path / "out" / "store.duckdb"
    out.parent.mkdir()
    (out.parent / "store.duckdb.partial").write_bytes(b"not a store")
    assert build_full(load_manifest(tiny.manifest), out, workers=1).ok
    assert _files(out.parent) == ["store.duckdb"]


def test_build_full_with_a_failing_verification_writes_the_store_and_records_the_problems(
    tiny: Synthetic, tmp_path: Path
) -> None:
    _with_target_assays(tiny, "NoSuchAssay")
    out = tmp_path / "out" / "store.duckdb"
    result = build_full(load_manifest(tiny.manifest), out, workers=1)
    assert not result.ok
    assert result.problems == ("the population is empty",)
    assert _files(out.parent) == ["store.duckdb"]
    con = duckdb.connect(str(out), read_only=True)
    try:
        recorded = json.loads(con.execute("SELECT value FROM store_meta WHERE key = 'verification'").fetchone()[0])  # type: ignore[index]
    finally:
        con.close()
    assert recorded["ok"] is False
    assert recorded["problems"] == ["the population is empty"]


def _use_select_config(synthetic: Synthetic, run: str, fields: dict[str, dict[str, object]]) -> None:
    config = synthetic.root / "config" / f"select-config-{run}.json"
    config.write_text(json.dumps({"fields": fields}))
    text = synthetic.manifest.read_text()
    head, marker, tail = text.partition(f"  - name: {run}\n")
    tail = tail.replace("config/select-config.json", f"config/select-config-{run}.json", 1)
    synthetic.manifest.write_text(head + marker + tail)


def _fields_with_drug_as(value_type: str) -> dict[str, dict[str, object]]:
    fields = {name: dict(spec) for name, spec in FIELDS.items()}
    fields["drug"]["value_type"] = value_type
    return fields


def test_build_rejects_a_field_that_is_single_valued_in_one_run_and_multi_valued_in_another(
    tiny: Synthetic, tmp_path: Path
) -> None:
    _use_select_config(tiny, "run2", _fields_with_drug_as("string"))
    out = tmp_path / "out" / "store.duckdb"
    with pytest.raises(BuildError, match=r"'drug' is single-valued in one run and multi-valued in another"):
        build_full(load_manifest(tiny.manifest), out, workers=1)
    assert _files(out.parent) == []

    first = tmp_path / "first" / "store.duckdb"
    only_run1 = tiny.manifest_with_runs(["run1"], tiny.root / "run1.yaml")
    assert build_full(load_manifest(only_run1), first, workers=1).ok
    appended = tmp_path / "appended" / "store.duckdb"
    with pytest.raises(BuildError, match="single-valued in one run and multi-valued in another"):
        build_append(load_manifest(tiny.manifest), first, appended, workers=1)
    assert _files(appended.parent) == []


def test_build_accepts_a_run_whose_select_config_lacks_a_field_of_another_run(tiny: Synthetic, tmp_path: Path) -> None:
    _use_select_config(tiny, "run2", {k: v for k, v in FIELDS.items() if k != "drug"})
    assert build_full(load_manifest(tiny.manifest), tmp_path / "store.duckdb", workers=1).ok


def test_build_reports_a_duplicate_accession_before_it_reads_the_reference_data(
    tiny: Synthetic, tmp_path: Path
) -> None:
    result = tiny.root / "results" / "select_run1.json"
    data = json.loads(result.read_text())
    data["entries"].append(data["entries"][0])
    result.write_text(json.dumps(data))
    (tiny.root / "reference" / "dblink.duckdb").write_text("not a database")
    with pytest.raises(BuildError, match="occurs more than once"):
        build_full(load_manifest(tiny.manifest), tmp_path / "out" / "store.duckdb", workers=1)


def test_build_names_the_first_of_two_runs_with_an_invalid_status(tiny: Synthetic, tmp_path: Path) -> None:
    for run in ("run1", "run2"):
        result = tiny.root / "results" / f"select_{run}.json"
        data = json.loads(result.read_text())
        data["run_metadata"]["status"] = "interrupted"
        result.write_text(json.dumps(data))
    with pytest.raises(BuildError, match="run run1 has status 'interrupted'"):
        build_full(load_manifest(tiny.manifest), tmp_path / "store.duckdb", workers=1)


# The label of a term comes from the first file of the manifest that defines it.


def test_build_full_with_a_term_in_two_ontologies_takes_the_label_of_the_earlier_ontology(
    tiny: Synthetic, tmp_path: Path
) -> None:
    with (tiny.root / "ontology" / "uberon.obo").open("a") as f:
        f.write("[Term]\nid: CHEBI:23888\nname: label from the earlier ontology\n\n")
    out = tmp_path / "store.duckdb"
    assert build_full(load_manifest(tiny.manifest), out, workers=1).ok
    con = duckdb.connect(str(out), read_only=True)
    try:
        assert con.execute("SELECT label FROM term WHERE term_id = 'CHEBI:23888'").fetchone() == (
            "label from the earlier ontology",
        )
        positions = con.execute(
            "SELECT ontology, source_index FROM ref_term GROUP BY ALL ORDER BY source_index"
        ).fetchall()
    finally:
        con.close()
    assert [p for _, p in positions] == list(range(len(positions)))
    assert [o for o, _ in positions] == ["cellosaurus", "mondo", "uberon", "chebi", "gene"]


# taxonomy_id and attribute content.


@pytest.mark.parametrize(
    ("value", "expected"),
    [(9606, 9606), ("9606", 9606), (None, None), ("", None), (str(MAX_TAXONOMY_ID), MAX_TAXONOMY_ID), (1, 1)],
)
def test_parse_input_doc_reads_the_taxonomy_id_of_an_integer_or_a_string_of_ascii_digits(
    value: object, expected: int | None
) -> None:
    doc = parse_input_doc(_doc(Description={"Organism": {"taxonomy_id": value}}))
    assert doc.organism_id == expected


@pytest.mark.parametrize(
    "value",
    [
        "\u00b2",
        "\u0663",
        "\uff19",
        "-1",
        "0",
        0,
        -5,
        3.5,
        True,
        "1.0",
        " 9606",
        "9606\n",
        MAX_TAXONOMY_ID + 1,
        "99999999999",
        [1],
    ],
)
def test_parse_input_doc_rejects_a_taxonomy_id_that_is_not_an_integer_in_range(value: object) -> None:
    with pytest.raises(ValueError, match="taxonomy_id"):
        parse_input_doc(_doc(Description={"Organism": {"taxonomy_id": value}}))


@given(st.one_of(st.text(), st.integers(), st.floats(), st.booleans(), st.none()))
def test_parse_input_doc_taxonomy_id_is_none_or_a_positive_int32_or_a_value_error(value: object) -> None:
    try:
        doc = parse_input_doc(_doc(Description={"Organism": {"taxonomy_id": value}}))
    except ValueError:
        return
    assert doc.organism_id is None or 1 <= doc.organism_id <= MAX_TAXONOMY_ID


def test_read_input_names_the_file_and_the_line_of_an_invalid_taxonomy_id(tmp_path: Path) -> None:
    path = tmp_path / "in.jsonl"
    good = json.dumps(_doc())
    bad = json.dumps(_doc(Description={"Organism": {"taxonomy_id": "\u00b2"}}))
    path.write_text(f"{good}\n\n{bad}\n")
    with pytest.raises(BuildError, match=r"in\.jsonl:3: taxonomy_id"):
        list(read_input(path))


@pytest.mark.parametrize("line", ["{bad", "[1]", '{"BioSample": {}}'])
def test_read_input_names_the_file_and_the_line_of_an_invalid_line(tmp_path: Path, line: str) -> None:
    path = tmp_path / "in.jsonl"
    path.write_text(json.dumps(_doc()) + "\n" + line + "\n")
    with pytest.raises(BuildError, match=r"in\.jsonl:2:"):
        list(read_input(path))


def test_parse_input_doc_keeps_a_number_as_the_content_of_an_attribute_and_drops_an_attribute_without_a_value() -> None:
    attributes = [
        {"attribute_name": "age", "content": 12},
        {"attribute_name": "weight", "content": 1.5},
        {"attribute_name": "zero", "content": 0},
        {"attribute_name": "text", "content": "x"},
        {"attribute_name": "null", "content": None},
        {"attribute_name": "flag", "content": True},
        {"attribute_name": "missing"},
    ]
    doc = parse_input_doc(_doc(Attributes={"Attribute": attributes}))
    assert [(a.name, a.value) for a in doc.attributes] == [
        ("age", "12"),
        ("weight", "1.5"),
        ("zero", "0"),
        ("text", "x"),
    ]


# Validation of the manifest and the inputs.


def test_load_manifest_rejects_duplicate_ontology_names(tiny: Synthetic) -> None:
    text = tiny.manifest.read_text().replace("name: mondo", "name: uberon")
    tiny.manifest.write_text(text)
    with pytest.raises(ValueError, match="duplicate ontology names: uberon"):
        load_manifest(tiny.manifest)


def test_load_manifest_rejects_the_same_result_file_under_two_run_names(tiny: Synthetic) -> None:
    tiny.manifest.write_text(
        tiny.manifest.read_text().replace("results/select_run2.json", "./results/select_run1.json")
    )
    with pytest.raises(ValueError, match="runs run1 and run2 have the same result file"):
        load_manifest(tiny.manifest)


def test_build_rejects_a_result_in_which_an_accession_occurs_twice(tiny: Synthetic, tmp_path: Path) -> None:
    result = tiny.root / "results" / "select_run1.json"
    data = json.loads(result.read_text())
    data["entries"].append(data["entries"][0])
    result.write_text(json.dumps(data))
    out = tmp_path / "store.duckdb"
    with pytest.raises(BuildError, match=r"run run1: entry .* occurs more than once"):
        build_full(load_manifest(tiny.manifest), out, workers=1)
    assert not out.exists()


def test_build_checks_the_status_of_the_runs_before_converting_any_run(tiny: Synthetic, tmp_path: Path) -> None:
    _drop_first_input_entry(tiny, "run1")
    result = tiny.root / "results" / "select_run2.json"
    data = json.loads(result.read_text())
    data["run_metadata"]["status"] = "interrupted"
    result.write_text(json.dumps(data))
    out = tmp_path / "out" / "store.duckdb"
    with pytest.raises(BuildError, match="run run2 has status 'interrupted'"):
        build_full(load_manifest(tiny.manifest), out, workers=1)
    assert _files(out.parent) == []


def test_build_checks_the_model_of_the_runs_before_converting_any_run(tiny: Synthetic, tmp_path: Path) -> None:
    _drop_first_input_entry(tiny, "run1")
    result = tiny.root / "results" / "select_run2.json"
    data = json.loads(result.read_text())
    data["run_metadata"]["model"] = "other"
    result.write_text(json.dumps(data))
    out = tmp_path / "out" / "store.duckdb"
    with pytest.raises(BuildError, match="different models"):
        build_full(load_manifest(tiny.manifest), out, workers=1)
    assert _files(out.parent) == []


def test_read_run_metadata_equals_the_metadata_of_the_parsed_result(tiny: Synthetic) -> None:
    path = tiny.root / "results" / "select_run1.json"
    assert read_run_metadata(path) == load_select_result(path)[0]


def test_read_run_metadata_reads_a_result_whose_run_metadata_comes_first(tiny: Synthetic) -> None:
    path = tiny.root / "results" / "select_run1.json"
    data = json.loads(path.read_text())
    path.write_text(json.dumps({"run_metadata": data["run_metadata"], "entries": data["entries"]}))
    assert read_run_metadata(path) == load_select_result(path)[0]


@pytest.mark.parametrize("damage", ["delete", "number"])
@pytest.mark.parametrize("member", ["run_name", "model", "status"])
def test_read_run_metadata_rejects_a_missing_or_mistyped_member(tiny: Synthetic, member: str, damage: str) -> None:
    path = tiny.root / "results" / "select_run1.json"
    data = json.loads(path.read_text())
    if damage == "delete":
        del data["run_metadata"][member]
    else:
        data["run_metadata"][member] = 5
    path.write_text(json.dumps(data))
    with pytest.raises(BuildError, match=r"select_run1\.json: invalid run_metadata"):
        read_run_metadata(path)


@pytest.mark.parametrize("damage", ["duplicate_ontology", "bad_input_line", "entry_missing_from_input", "bad_metadata"])
def test_cli_reports_an_invalid_manifest_or_input_as_an_error_and_leaves_no_store(
    tiny: Synthetic, tmp_path: Path, capsys: pytest.CaptureFixture[str], damage: str
) -> None:
    if damage == "duplicate_ontology":
        tiny.manifest.write_text(tiny.manifest.read_text().replace("name: mondo", "name: uberon"))
    elif damage == "bad_input_line":
        with (tiny.root / "inputs" / "run1.jsonl").open("a") as f:
            f.write("{broken\n")
    elif damage == "entry_missing_from_input":
        _drop_first_input_entry(tiny)
    else:
        result = tiny.root / "results" / "select_run1.json"
        data = json.loads(result.read_text())
        del data["run_metadata"]["status"]
        result.write_text(json.dumps(data))
    out = tmp_path / "out" / "store.duckdb"
    code = main(["full", "--manifest", str(tiny.manifest), "--out", str(out), "--workers", "1"])
    err = capsys.readouterr().err
    assert code == 1
    assert err.startswith("error:")
    assert "Traceback" not in err
    assert not out.parent.exists() or _files(out.parent) == []


# verify reports the missing tables of an empty DuckDB file as problems of the store, so only info has that case.
@pytest.mark.parametrize(
    ("command", "store"),
    [
        ("verify", "missing"),
        ("verify", "not_duckdb"),
        ("info", "missing"),
        ("info", "not_duckdb"),
        ("info", "empty_duckdb"),
    ],
)
def test_cli_verify_and_info_report_a_store_that_they_cannot_read_as_an_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], command: str, store: str
) -> None:
    path = tmp_path / f"{store}.duckdb"
    if store == "not_duckdb":
        path.write_text("not a store")
    elif store == "empty_duckdb":
        duckdb.connect(str(path)).close()
    assert main([command, "--store", str(path)]) == 1
    err = capsys.readouterr().err
    assert err.startswith("error: "), err
    assert "Traceback" not in err
    assert str(path) in err


@pytest.mark.parametrize("command", ["full", "append", "refresh", "verify"])
def test_cli_with_a_failing_verification_exits_with_status_1_prints_the_json_and_keeps_the_store(
    tiny: Synthetic, tmp_path: Path, capsys: pytest.CaptureFixture[str], command: str
) -> None:
    out = tmp_path / "out" / "store.duckdb"
    if command == "verify":
        store = _store_with_failing_verification(tiny, tmp_path)
        argv = ["verify", "--store", str(store)]
        expected = store
    else:
        only_run1 = tiny.manifest_with_runs(["run1"], tiny.root / "run1.yaml")
        first = tmp_path / "first.duckdb"
        assert build_full(load_manifest(only_run1), first, workers=1).ok
        if command == "refresh":
            first = tmp_path / "all.duckdb"
            assert build_full(load_manifest(tiny.manifest), first, workers=1).ok
        _with_target_assays(tiny, "NoSuchAssay")
        manifest = ["--manifest", str(tiny.manifest), "--out", str(out)]
        argv = {
            "full": ["full", *manifest, "--workers", "1"],
            "append": ["append", *manifest, "--store", str(first), "--workers", "1"],
            "refresh": ["refresh", *manifest, "--store", str(first)],
        }[command]
        expected = out
    assert main(argv) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["ok"] is False
    assert "the population is empty" in report["problems"]
    assert expected.exists()


def test_cli_info_prints_the_version_of_the_store_as_json(
    tiny: Synthetic, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    store = tmp_path / "store.duckdb"
    assert build_full(load_manifest(tiny.manifest), store, workers=1).ok
    assert main(["info", "--store", str(store)]) == 0
    printed = json.loads(capsys.readouterr().out)
    con = duckdb.connect(str(store), read_only=True)
    try:
        expected = read_version(con).model_dump()
    finally:
        con.close()
    assert printed == json.loads(json.dumps(expected))
    assert printed["name"] == "synthetic"
    assert [r["name"] for r in printed["runs"]] == tiny.run_names


@pytest.mark.parametrize("missing", ["manifest", "store"])
@pytest.mark.parametrize("command", ["append", "refresh"])
def test_cli_append_and_refresh_report_a_missing_manifest_or_store_as_an_error_and_leave_no_store(
    tiny: Synthetic, store_path: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str], command: str, missing: str
) -> None:
    out = tmp_path / "out" / "store.duckdb"
    manifest = tmp_path / "no-manifest.yaml" if missing == "manifest" else tiny.manifest
    store = tmp_path / "no-store.duckdb" if missing == "store" else store_path
    code = main([command, "--manifest", str(manifest), "--store", str(store), "--out", str(out)])
    err = capsys.readouterr().err
    assert code == 1
    assert err.startswith("error:"), err
    assert "Traceback" not in err
    assert not out.parent.exists() or _files(out.parent) == []


def test_cli_stops_on_a_duplicate_ontology_name_before_it_reads_any_run(
    tiny: Synthetic, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    tiny.manifest.write_text(tiny.manifest.read_text().replace("name: mondo", "name: uberon"))
    for result in (tiny.root / "results").iterdir():
        result.unlink()
    assert main(["full", "--manifest", str(tiny.manifest), "--out", str(tmp_path / "s.duckdb")]) == 1
    assert "duplicate ontology names" in capsys.readouterr().err


def _hold_partial(out: Path) -> subprocess.Popen[str]:
    """A process that keeps the partial file of `out` open in DuckDB, as a running build does."""
    code = (
        "import duckdb, sys\n"
        "con = duckdb.connect(sys.argv[1])\n"
        "con.execute('CREATE TABLE t (x INTEGER)')\n"
        "print('ready', flush=True)\n"
        "sys.stdin.readline()\n"
    )
    process = subprocess.Popen(
        [sys.executable, "-c", code, str(out) + ".partial"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
    )
    assert process.stdout is not None
    assert process.stdout.readline().strip() == "ready"
    return process


def test_build_full_while_another_build_writes_the_same_output_stops_and_keeps_its_file(
    tiny: Synthetic, tmp_path: Path
) -> None:
    out = tmp_path / "out" / "store.duckdb"
    out.parent.mkdir()
    other = _hold_partial(out)
    try:
        with pytest.raises(BuildError, match="another build"):
            build_full(load_manifest(tiny.manifest), out, workers=1)
        assert (out.parent / "store.duckdb.partial").exists()
        assert not out.exists()
    finally:
        assert other.stdin is not None
        other.stdin.write("\n")
        other.stdin.flush()
        other.wait(timeout=30)


def test_build_full_when_the_output_appears_during_the_build_does_not_replace_it(
    tiny: Synthetic, tmp_path: Path
) -> None:
    # The build reads the ChIP-Atlas file last. A FIFO at its path holds the build until the output exists.
    out = tmp_path / "out" / "store.duckdb"
    chip_atlas = tiny.root / "reference" / "experimentList.tab"
    content = chip_atlas.read_bytes()
    chip_atlas.unlink()
    os.mkfifo(chip_atlas)
    errors: list[BaseException] = []

    def build() -> None:
        try:
            build_full(load_manifest(tiny.manifest), out, workers=1)
        except BaseException as e:
            errors.append(e)

    thread = threading.Thread(target=build)
    thread.start()
    deadline = time.monotonic() + 30
    partial = out.parent / "store.duckdb.partial"
    while not partial.exists() and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert partial.exists()
    out.write_bytes(b"another store")
    fd = -1
    while fd < 0 and thread.is_alive() and time.monotonic() < deadline:
        try:
            fd = os.open(chip_atlas, os.O_WRONLY | os.O_NONBLOCK)
        except OSError:
            time.sleep(0.02)
    assert fd >= 0
    try:
        os.write(fd, content)
    finally:
        os.close(fd)
    thread.join(timeout=30)
    assert not thread.is_alive()
    assert len(errors) == 1
    assert isinstance(errors[0], BuildError)
    assert "already exists" in str(errors[0])
    assert out.read_bytes() == b"another store"
    assert _files(out.parent) == ["store.duckdb"]


def test_store_open_with_a_store_of_another_schema_version_points_to_a_full_build(
    store_path: Path, tmp_path: Path
) -> None:
    copy = tmp_path / "old.duckdb"
    shutil.copy(store_path, copy)
    con = duckdb.connect(str(copy))
    con.execute("UPDATE store_meta SET value = '7' WHERE key = 'schema_version'")
    con.close()
    with pytest.raises(RuntimeError, match="full build") as raised:
        Store(copy)
    assert "refresh" not in str(raised.value)


@pytest.mark.parametrize(
    "put_run_metadata",
    ["as_run_name", "after_entries_as_key", "before_entries_as_extracted_key", "as_extracted_value"],
)
def test_read_run_metadata_when_the_key_text_occurs_elsewhere_equals_the_parsed_metadata(
    tiny: Synthetic, put_run_metadata: str
) -> None:
    path = tiny.root / "results" / "select_run1.json"
    data = json.loads(path.read_text())
    metadata = data["run_metadata"]
    if put_run_metadata == "as_run_name":
        metadata["run_name"] = "run_metadata"
        document = {"entries": data["entries"], "run_metadata": metadata, "errors": ["run_metadata", "x"]}
    elif put_run_metadata == "after_entries_as_key":
        document = {"entries": data["entries"], "run_metadata": metadata, "errors": [{"run_metadata": 1}]}
    elif put_run_metadata == "before_entries_as_extracted_key":
        data["entries"][0]["extract"]["extracted"]["run_metadata"] = "x"
        document = {"run_metadata": metadata, "entries": data["entries"]}
    else:
        data["entries"][0]["extract"]["extracted"]["cell_line"] = "run_metadata"
        document = {"run_metadata": metadata, "entries": data["entries"]}
    path.write_text(json.dumps(document, indent=1))
    assert read_run_metadata(path) == load_select_result(path)[0]
    assert read_run_metadata(path).model == metadata["model"]


def test_read_run_metadata_when_the_last_key_text_has_no_object_falls_back_to_the_whole_file(tiny: Synthetic) -> None:
    path = tiny.root / "results" / "select_run1.json"
    data = json.loads(path.read_text())
    document = {"run_metadata": data["run_metadata"], "entries": data["entries"], "note": '{"run_metadata": 5}'}
    path.write_text(json.dumps(document))
    assert read_run_metadata(path) == load_select_result(path)[0]


def test_convert_run_with_a_broken_input_line_names_the_run(tiny: Synthetic, tmp_path: Path) -> None:
    other = tiny.root / "other"
    other.mkdir()
    shutil.copy(tiny.root / "inputs" / "run2.jsonl", other / "run1.jsonl")
    with (other / "run1.jsonl").open("a") as f:
        f.write("{broken\n")
    text = tiny.manifest.read_text().replace("inputs/run1.jsonl", "other/run1.jsonl")
    tiny.manifest.write_text(text)
    with pytest.raises(BuildError, match=r"run run1: run1\.jsonl:\d+:"):
        build_full(load_manifest(tiny.manifest), tmp_path / "s.duckdb", workers=1)


def test_read_entry_with_an_extracted_that_is_not_an_object_is_an_extraction_failure() -> None:
    entry = read_entry({"extract": {"accession": "S1", "extracted": ["a"]}}, ["cell_line", "tissue"])
    assert [(r.field, r.status, r.extracted_value) for r in entry.annotations] == [
        ("cell_line", "extraction_failed", None),
        ("tissue", "extraction_failed", None),
    ]


@pytest.mark.parametrize("member", ["Description", "Organism"])
def test_read_input_with_a_description_or_organism_that_is_not_an_object_names_the_line(
    tmp_path: Path, member: str
) -> None:
    body = {"Description": ["x"]} if member == "Description" else {"Description": {"Organism": "human"}}
    path = tmp_path / "in.jsonl"
    path.write_text(json.dumps(_doc(**body)) + "\n")
    with pytest.raises(BuildError, match=rf"in\.jsonl:1: {member} is not an object"):
        list(read_input(path))


def test_load_select_result_with_invalid_json_names_the_file(tmp_path: Path) -> None:
    path = tmp_path / "select_x.json"
    path.write_text("{broken")
    with pytest.raises(BuildError, match=r"select_x\.json: invalid JSON"):
        load_select_result(path)


@pytest.mark.parametrize("text", ['{"entries": 1}', "[]", '{"run_metadata": {}}'])
def test_load_select_result_without_a_list_of_entries_names_the_file(tmp_path: Path, text: str) -> None:
    path = tmp_path / "select_x.json"
    path.write_text(text)
    with pytest.raises(BuildError, match=r"select_x\.json: 'entries' is not a list"):
        load_select_result(path)


@pytest.mark.parametrize(
    ("line", "message"),
    [
        ("{broken", r"invalid JSON"),
        ("[1]", r"not a JSON object"),
        ('{"title": "x"}', r"identifier is not a non-empty string"),
        ('{"identifier": 5}', r"identifier is not a non-empty string"),
        ('{"identifier": ""}', r"identifier is not a non-empty string"),
    ],
)
@pytest.mark.parametrize("reader", [read_experiments, read_bioprojects])
def test_reference_readers_with_an_invalid_line_name_the_file_and_the_line(
    tmp_path: Path, reader: Callable[[Path], Iterator[object]], line: str, message: str
) -> None:
    path = tmp_path / "sra_experiment.jsonl"
    path.write_text('{"identifier": "A1"}\n\n' + line + "\n")
    with pytest.raises(BuildError, match=rf"sra_experiment\.jsonl:3: .*{message}"):
        list(reader(path))


@pytest.mark.parametrize("text", ["\uff76\uff9e", "\u3131\u314f", "\uff8a\uff9f"])
def test_text_with_characters_that_nfkc_composes_with_the_previous_one_keeps_them_in_one_unit(text: str) -> None:
    assert Text(text).length() == 1
    assert Text(text).folded()[0] == unicodedata.normalize("NFKC", text).casefold()


def test_trace_with_half_width_voiced_kana_matches_the_full_width_kana() -> None:
    traced = trace("\u30ac\u30ac\u30ac", [[Text("\uff76\uff9e\uff76\uff9e\uff76\uff9e cells")]])
    assert traced is not None
    assert traced.strategy == CASE_INSENSITIVE
    assert (traced.matches[0].span.start, traced.matches[0].span.end) == (0, 6)
