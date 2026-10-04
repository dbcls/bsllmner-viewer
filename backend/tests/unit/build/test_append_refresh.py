from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import duckdb
import pytest

from bsllmner_viewer.build.errors import BuildError
from bsllmner_viewer.build.ingest import build_append, build_full, build_refresh
from bsllmner_viewer.build.manifest import load_manifest
from bsllmner_viewer.build.verify import Verification
from bsllmner_viewer.store.schema import DERIVED_TABLES, RAW_TABLES
from tests.synthetic import Synthetic, generate


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _names(directory: Path) -> list[str]:
    return sorted(p.name for p in directory.iterdir()) if directory.exists() else []


def _snapshot(path: Path) -> dict[str, list[tuple[object, ...]]]:
    """Every table of a store without the columns that hold the time of the build."""
    con = duckdb.connect(str(path), read_only=True)
    try:
        out: dict[str, list[tuple[object, ...]]] = {}
        for table in (*RAW_TABLES, *DERIVED_TABLES):
            if table == "store_meta":
                rows = con.execute("SELECT key, value FROM store_meta WHERE key <> 'created_at'").fetchall()
            else:
                columns = [c[0] for c in con.execute(f"DESCRIBE {table}").fetchall() if c[0] != "ingested_at"]
                rows = con.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
            out[table] = sorted(rows, key=repr)
        return out
    finally:
        con.close()


def _ingested_at(path: Path) -> dict[str, object]:
    con = duckdb.connect(str(path), read_only=True)
    try:
        return {str(n): t for n, t in con.execute("SELECT name, ingested_at FROM run").fetchall()}
    finally:
        con.close()


def _prefix_store(syn: Synthetic, k: int) -> Path:
    """A store of the first `k` runs, written next to the dataset."""
    manifest = syn.manifest_with_runs(syn.run_names[:k], syn.root / f"prefix{k}.yaml")
    store = syn.root / "store" / f"prefix{k}.duckdb"
    assert build_full(load_manifest(manifest), store, workers=1).ok
    return store


def _change_reference(root: Path) -> None:
    bioproject = root / "reference" / "bioproject" / "ncbi_1.jsonl"
    bioproject.write_text(bioproject.read_text().replace("Project ", "Renamed project "))
    chip = root / "reference" / "experimentList.tab"
    lines = chip.read_text().splitlines()
    chip.write_text("\n".join(lines[: len(lines) // 2]) + "\n")


def _operate(operation: str, manifest: Path, store: Path, out: Path) -> Verification:
    if operation == "append":
        return build_append(load_manifest(manifest), store, out, workers=1)
    return build_refresh(load_manifest(manifest), store, out)


@pytest.fixture
def syn(tmp_path: Path) -> Synthetic:
    return generate(tmp_path / "syn", seed=3, n_biosamples=12, n_runs=3)


def _assert_rejected(match: str, call: object, out: Path, store: Path) -> None:
    before = _sha256(store)
    with pytest.raises(BuildError, match=match):
        call()  # type: ignore[operator]
    assert _names(out.parent) == []
    assert _sha256(store) == before


def test_append_without_a_run_that_is_not_in_the_store_is_rejected_and_leaves_no_file(
    syn: Synthetic, tmp_path: Path
) -> None:
    store = _prefix_store(syn, 3)
    out = tmp_path / "out" / "appended.duckdb"
    _assert_rejected(
        "no runs that are not already in the store",
        lambda: build_append(load_manifest(syn.manifest), store, out, workers=1),
        out,
        store,
    )


@pytest.mark.parametrize("damage", ["swapped", "missing", "renamed"])
def test_append_with_a_manifest_that_does_not_list_the_runs_of_the_store_first_in_order_is_rejected(
    syn: Synthetic, tmp_path: Path, damage: str
) -> None:
    store = _prefix_store(syn, 2)
    names = {
        "swapped": ["run2", "run1", "run3"],
        "missing": ["run1", "run3"],
        "renamed": ["run3", "run1", "run2"],
    }[damage]
    manifest = syn.manifest_with_runs(names, syn.root / "damaged.yaml")
    out = tmp_path / "out" / "appended.duckdb"
    _assert_rejected(
        "must list the runs already in the store first",
        lambda: build_append(load_manifest(manifest), store, out, workers=1),
        out,
        store,
    )


@pytest.mark.parametrize("operation", ["append", "refresh"])
def test_append_and_refresh_from_a_store_that_does_not_exist_are_rejected(
    syn: Synthetic, tmp_path: Path, operation: str
) -> None:
    out = tmp_path / "out" / "new.duckdb"
    missing = tmp_path / "no-such.duckdb"
    with pytest.raises(BuildError, match="does not exist"):
        _operate(operation, syn.manifest, missing, out)
    assert _names(out.parent) == []


@pytest.mark.parametrize("damage", ["added", "missing", "swapped"])
def test_refresh_with_runs_other_than_the_runs_of_the_store_is_rejected(
    syn: Synthetic, tmp_path: Path, damage: str
) -> None:
    store = _prefix_store(syn, 2)
    names = {"added": ["run1", "run2", "run3"], "missing": ["run1"], "swapped": ["run2", "run1"]}[damage]
    manifest = syn.manifest_with_runs(names, syn.root / "damaged.yaml")
    out = tmp_path / "out" / "refreshed.duckdb"
    _assert_rejected(
        "requires the manifest to list exactly the runs",
        lambda: build_refresh(load_manifest(manifest), store, out),
        out,
        store,
    )


@pytest.mark.parametrize("operation", ["append", "refresh"])
def test_append_and_refresh_reject_an_existing_output_and_keep_it(
    syn: Synthetic, tmp_path: Path, operation: str
) -> None:
    store = _prefix_store(syn, 2)
    out = tmp_path / "out" / "existing.duckdb"
    out.parent.mkdir()
    out.write_bytes(b"another file")
    before = _sha256(store)
    manifest = (
        syn.manifest if operation == "append" else syn.manifest_with_runs(["run1", "run2"], syn.root / "two.yaml")
    )
    with pytest.raises(BuildError, match="already exists"):
        _operate(operation, manifest, store, out)
    assert out.read_bytes() == b"another file"
    assert _names(out.parent) == ["existing.duckdb"]
    assert _sha256(store) == before


@pytest.mark.parametrize("failure", ["append_interrupted_run", "append_missing_reference", "refresh_missing_reference"])
def test_append_and_refresh_that_fail_leave_no_file(syn: Synthetic, tmp_path: Path, failure: str) -> None:
    out = tmp_path / "out" / "failed.duckdb"
    operation = failure.split("_")[0]
    store = _prefix_store(syn, 3 if operation == "refresh" else 2)
    if failure == "append_interrupted_run":
        path = syn.root / "results" / "select_run3.json"
        body = json.loads(path.read_text())
        body["run_metadata"]["status"] = "interrupted"
        path.write_text(json.dumps(body))
    else:
        (syn.root / "reference" / "experimentList.tab").unlink()
    before = _sha256(store)
    with pytest.raises((BuildError, OSError)):
        _operate(operation, syn.manifest, store, out)
    assert _names(out.parent) == []
    assert _sha256(store) == before


@pytest.mark.parametrize("operation", ["append", "refresh"])
def test_append_and_refresh_with_a_stale_partial_file_remove_it(syn: Synthetic, tmp_path: Path, operation: str) -> None:
    store = _prefix_store(syn, 2)
    out = tmp_path / "out" / "new.duckdb"
    out.parent.mkdir()
    partial = out.with_name(out.name + ".partial")
    partial.write_bytes(b"stale partial")
    manifest = (
        syn.manifest if operation == "append" else syn.manifest_with_runs(["run1", "run2"], syn.root / "two.yaml")
    )
    result = _operate(operation, manifest, store, out)
    assert result.ok
    assert _names(out.parent) == ["new.duckdb"]


def test_append_rejects_a_run_with_a_model_other_than_the_model_of_the_store(syn: Synthetic, tmp_path: Path) -> None:
    store = _prefix_store(syn, 2)
    path = syn.root / "results" / "select_run3.json"
    body = json.loads(path.read_text())
    body["run_metadata"]["model"] = "another-model:2"
    path.write_text(json.dumps(body))
    out = tmp_path / "out" / "appended.duckdb"
    _assert_rejected(
        "runs use different models",
        lambda: build_append(load_manifest(syn.manifest), store, out, workers=1),
        out,
        store,
    )


def test_append_reads_the_reference_data_of_the_manifest_and_keeps_the_ingested_at_of_the_runs_in_the_store(
    syn: Synthetic, tmp_path: Path
) -> None:
    store = _prefix_store(syn, 1)
    _change_reference(syn.root)
    before = _sha256(store)
    appended = build_append(load_manifest(syn.manifest), store, tmp_path / "appended.duckdb", workers=1)
    assert appended.ok
    full = build_full(load_manifest(syn.manifest), tmp_path / "full.duckdb", workers=1)
    assert full.ok
    snapshot = _snapshot(tmp_path / "appended.duckdb")
    assert any("Renamed project" in str(row) for row in snapshot["ref_bioproject"])
    assert snapshot == _snapshot(tmp_path / "full.duckdb")
    assert _ingested_at(tmp_path / "appended.duckdb")["run1"] == _ingested_at(store)["run1"]
    assert _sha256(store) == before


def _population_assays(path: Path) -> set[str]:
    con = duckdb.connect(str(path), read_only=True)
    try:
        return {str(r[0]) for r in con.execute("SELECT DISTINCT library_strategy FROM population").fetchall()}
    finally:
        con.close()


def _synonym_evidence(path: Path) -> list[tuple[object, ...]]:
    con = duckdb.connect(str(path), read_only=True)
    try:
        return sorted(con.execute("SELECT * FROM evidence WHERE strategy = 'ontology_synonym'").fetchall(), key=repr)
    finally:
        con.close()


def test_refresh_with_changed_target_assays_and_reference_data_equals_a_full_build_without_reading_the_runs(
    tmp_path: Path,
) -> None:
    syn = generate(tmp_path / "syn", seed=3, n_biosamples=12, n_runs=2)
    first = tmp_path / "first.duckdb"
    assert build_full(load_manifest(syn.manifest), first, workers=1).ok
    root = syn.root
    changed = root / "changed.yaml"
    changed.write_text(syn.manifest.read_text().replace("ATAC-seq]", "ATAC-seq, WGS]"))
    _change_reference(root)
    chebi = root / "ontology" / "chebi.obo"
    chebi.write_text(chebi.read_text().replace('synonym: "dex" EXACT []\n', ""))
    mondo = root / "ontology" / "mondo.obo"
    mondo.write_text(
        mondo.read_text().replace("id: MONDO:0004992\n", 'id: MONDO:0004992\nsynonym: "tumour" EXACT []\n')
    )
    full = tmp_path / "changed-full.duckdb"
    assert build_full(load_manifest(changed), full, workers=1).ok
    assert "WGS" in _population_assays(full)
    assert "WGS" not in _population_assays(first)
    assert _synonym_evidence(full) != _synonym_evidence(first)
    shutil.rmtree(root / "results")
    shutil.rmtree(root / "inputs")
    before = _sha256(first)
    refreshed = build_refresh(load_manifest(changed), first, tmp_path / "refreshed.duckdb")
    assert refreshed.ok
    assert _snapshot(tmp_path / "refreshed.duckdb") == _snapshot(full)
    assert _ingested_at(tmp_path / "refreshed.duckdb") == _ingested_at(first)
    assert _sha256(first) == before


def _damage_derived_tables(path: Path) -> None:
    con = duckdb.connect(str(path))
    try:
        con.execute("DELETE FROM population WHERE rowid % 2 = 0")
        con.execute("UPDATE searchable_text SET text = 'damaged'")
        con.execute("DELETE FROM term_closure")
        con.execute("DELETE FROM evidence WHERE rowid % 2 = 0")
        con.execute("UPDATE annotation SET term_id = NULL")
        con.execute("CHECKPOINT")
    finally:
        con.close()


@pytest.mark.parametrize("operation", ["append", "refresh"])
def test_append_and_refresh_recompute_the_derived_tables_of_a_damaged_input_store(
    syn: Synthetic, tmp_path: Path, operation: str
) -> None:
    k = 2 if operation == "append" else 3
    store = tmp_path / "damaged.duckdb"
    shutil.copy(_prefix_store(syn, k), store)
    _damage_derived_tables(store)
    out = tmp_path / "out.duckdb"
    if operation == "append":
        result = build_append(load_manifest(syn.manifest), store, out, workers=1)
    else:
        result = build_refresh(load_manifest(syn.manifest), store, out)
    assert result.ok
    full = tmp_path / "full.duckdb"
    assert build_full(load_manifest(syn.manifest), full, workers=1).ok
    assert _snapshot(out) == _snapshot(full)
