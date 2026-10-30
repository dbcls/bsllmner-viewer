from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import duckdb
import pytest
import yaml

from bsllmner_viewer.build.errors import BuildError
from bsllmner_viewer.build.ingest import build_append, build_full, build_refresh
from bsllmner_viewer.build.manifest import load_manifest
from bsllmner_viewer.store.schema import DERIVED_TABLES, RAW_TABLES
from bsllmner_viewer.store.version import read_version
from tests.synthetic import Synthetic, generate

Entry = dict[str, Any]


@pytest.fixture
def syn(tmp_path: Path) -> Synthetic:
    return generate(tmp_path / "data", seed=5, n_biosamples=48, n_runs=2, overlap=0.25)


def _result_of(syn: Synthetic, run: str) -> Path:
    return syn.root / "results" / f"select_{run}.json"


def _accessions(syn: Synthetic, run: str) -> list[str]:
    return [e["extract"]["accession"] for e in json.loads(_result_of(syn, run).read_text())["entries"]]


def _unmap(entry: Entry) -> None:
    """Take every term away from the entry, as if no value of the entry had a term."""
    entry["results"] = {field: [] for field in entry.get("results") or {}}
    entry["select_timings"] = {}


def _write_reselect(
    syn: Synthetic,
    run: str,
    accessions: list[str],
    *,
    change: Callable[[Entry], None] = _unmap,
    metadata: Callable[[dict[str, Any]], None] = lambda _: None,
    entries: Callable[[list[Entry]], None] = lambda _: None,
) -> Path:
    """Write the result of a reselect run over `run` that has the entries of `accessions`, each changed by `change`."""
    source = _result_of(syn, run)
    data = json.loads(source.read_text())
    chosen = [copy.deepcopy(e) for e in data["entries"] if e["extract"]["accession"] in accessions]
    for entry in chosen:
        change(entry)
    entries(chosen)
    run_metadata = {
        **data["run_metadata"],
        "run_name": f"{run}_reselect",
        "reselect": {
            "source_result_file": source.name,
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "source_run_name": run,
            "fields": ["disease"],
        },
    }
    metadata(run_metadata)
    out = syn.root / "results" / f"select_{run}_reselect.json"
    out.write_text(json.dumps({"entries": chosen, "run_metadata": run_metadata}))
    return out


def _manifest(syn: Synthetic, name: str, runs: list[str], reselect: dict[str, str]) -> Path:
    """A manifest of `runs`, where each run named in `reselect` has the reselect run whose result file is given."""
    data = yaml.safe_load(syn.manifest.read_text())
    data["runs"] = [r for r in data["runs"] if r["name"] in runs]
    for spec in data["runs"]:
        if spec["name"] in reselect:
            spec["reselect"] = {
                "name": f"{spec['name']}_reselect",
                "result": reselect[spec["name"]],
                "mk2_version": "def5678",
            }
    out = syn.root / f"{name}.yaml"
    out.write_text(yaml.safe_dump(data, sort_keys=False))
    return out


def _merged_result(syn: Synthetic, run: str, reselect: Path) -> str:
    """The result of `run` with each entry that the reselect result has replaced by that entry, as a relative path."""
    data = json.loads(_result_of(syn, run).read_text())
    replaced = {e["extract"]["accession"]: e for e in json.loads(reselect.read_text())["entries"]}
    data["entries"] = [replaced.get(e["extract"]["accession"], e) for e in data["entries"]]
    out = syn.root / "results" / f"merged_{run}.json"
    out.write_text(json.dumps(data))
    return str(out.relative_to(syn.root))


def _snapshot(path: Path) -> dict[str, list[tuple[object, ...]]]:
    """The tables of a store that do not record the runs themselves."""
    con = duckdb.connect(str(path), read_only=True)
    try:
        return {
            table: sorted(con.execute(f"SELECT * FROM {table}").fetchall(), key=repr)
            for table in (*RAW_TABLES, *DERIVED_TABLES)
            if table not in ("store_meta", "run")
        }
    finally:
        con.close()


def _statuses(path: Path, accessions: list[str]) -> list[tuple[object, ...]]:
    con = duckdb.connect(str(path), read_only=True)
    try:
        return con.execute(
            "SELECT biosample, field, value_index, status, term_id FROM annotation WHERE list_contains(?, biosample) "
            "ORDER BY ALL",
            [accessions],
        ).fetchall()
    finally:
        con.close()


def _path(syn: Synthetic, path: Path) -> str:
    return str(path.relative_to(syn.root))


def _build(manifest: Path, out: Path) -> Path:
    result = build_full(load_manifest(manifest), out, workers=1)
    assert result.ok, result.problems
    return out


@pytest.mark.parametrize("share", [0.0, 0.5, 1.0])
def test_build_with_a_reselect_run_equals_a_build_whose_run_result_has_the_entries_of_the_reselect_run(
    syn: Synthetic, share: float
) -> None:
    run = syn.run_names[0]
    accessions = _accessions(syn, run)
    chosen = accessions[: int(len(accessions) * share)]
    reselect = _write_reselect(syn, run, chosen)
    manifest = _manifest(syn, "with", syn.run_names, {run: _path(syn, reselect)})
    with_reselect = _build(manifest, syn.root / "store" / "with_reselect.duckdb")
    data = yaml.safe_load(syn.manifest.read_text())
    data["runs"][0]["result"] = _merged_result(syn, run, reselect)
    merged_manifest = syn.root / "merged.yaml"
    merged_manifest.write_text(yaml.safe_dump(data, sort_keys=False))
    merged = _build(merged_manifest, syn.root / "store" / "merged.duckdb")
    assert _snapshot(with_reselect) == _snapshot(merged)
    without = _build(syn.manifest, syn.root / "store" / "without.duckdb")
    unchanged = accessions[len(chosen) :]
    assert _statuses(with_reselect, unchanged) == _statuses(without, unchanged)
    if chosen:
        assert _statuses(with_reselect, chosen) != _statuses(without, chosen)


def test_build_records_the_reselect_run_of_a_run_in_the_store_and_in_the_version(syn: Synthetic) -> None:
    run = syn.run_names[0]
    chosen = _accessions(syn, run)[:5]
    reselect = _write_reselect(syn, run, chosen)
    store = _build(_manifest(syn, "with", syn.run_names, {run: _path(syn, reselect)}), syn.root / "store" / "s.duckdb")
    con = duckdb.connect(str(store), read_only=True)
    try:
        rows = con.execute(
            "SELECT name, reselect_name, reselect_result_file, reselect_mk2_version, reselect_entry_count FROM run "
            "ORDER BY manifest_index"
        ).fetchall()
        version = read_version(con)
    finally:
        con.close()
    assert rows == [
        (run, f"{run}_reselect", _path(syn, reselect), "def5678", len(chosen)),
        (syn.run_names[1], None, None, None, None),
    ]
    assert [(r.name, r.reselect.name if r.reselect else None) for r in version.runs] == [
        (run, f"{run}_reselect"),
        (syn.run_names[1], None),
    ]
    assert version.runs[0].reselect is not None
    assert version.runs[0].reselect.mk2_version == "def5678"


def _first_entries(entries: list[Entry]) -> None:
    entries.append(copy.deepcopy(entries[0]))


def _foreign_entry(entries: list[Entry]) -> None:
    stranger = copy.deepcopy(entries[0])
    stranger["extract"]["accession"] = "SAMN99999999"
    entries.append(stranger)


def _other_extract(entries: list[Entry]) -> None:
    entries[0]["extract"]["extracted"] = {"disease": "something that the run did not extract"}


def _without_accession(entries: list[Entry]) -> None:
    del entries[0]["extract"]["accession"]


def _without_reselect(metadata: dict[str, Any]) -> None:
    del metadata["reselect"]


def _other_source_run(metadata: dict[str, Any]) -> None:
    metadata["reselect"]["source_run_name"] = "another_run"


def _other_source_checksum(metadata: dict[str, Any]) -> None:
    metadata["reselect"]["source_sha256"] = "0" * 64


def _other_model(metadata: dict[str, Any]) -> None:
    metadata["model"] = "another-model:1"


def _not_completed(metadata: dict[str, Any]) -> None:
    metadata["status"] = "interrupted"


@pytest.mark.parametrize(
    ("metadata", "entries", "message"),
    [
        (_without_reselect, lambda _: None, "run_metadata.reselect is missing"),
        (_other_source_run, lambda _: None, "reselects run 'another_run'"),
        (_other_source_checksum, lambda _: None, "read another version of the result file"),
        (_other_model, lambda _: None, "runs use different models"),
        (_not_completed, lambda _: None, "has status 'interrupted'"),
        (lambda _: None, _first_entries, "occurs more than once in the result file"),
        (lambda _: None, _foreign_entry, "SAMN99999999 is not in the result of run"),
        (lambda _: None, _other_extract, "has another extract than the entry of run"),
        (lambda _: None, _without_accession, "SelectResult entry without accession"),
    ],
)
def test_build_with_a_reselect_run_that_does_not_match_its_run_stops_and_leaves_no_file(
    syn: Synthetic,
    metadata: Callable[[dict[str, Any]], None],
    entries: Callable[[list[Entry]], None],
    message: str,
) -> None:
    run = syn.run_names[0]
    reselect = _write_reselect(syn, run, _accessions(syn, run)[:3], metadata=metadata, entries=entries)
    out = syn.root / "store" / "s.duckdb"
    with pytest.raises(BuildError, match=message):
        build_full(load_manifest(_manifest(syn, "bad", syn.run_names, {run: _path(syn, reselect)})), out, workers=1)
    assert sorted(p.name for p in out.parent.iterdir()) == []


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda spec: spec["reselect"].update(name=spec["name"]), "duplicate run names"),
        (lambda spec: spec["reselect"].update(result=spec["result"]), "have the same result file"),
    ],
)
def test_manifest_with_a_reselect_run_that_repeats_a_run_name_or_result_file_is_rejected(
    syn: Synthetic, change: Callable[[dict[str, Any]], None], message: str
) -> None:
    run = syn.run_names[0]
    reselect = _write_reselect(syn, run, _accessions(syn, run)[:3])
    manifest = _manifest(syn, "bad", syn.run_names, {run: _path(syn, reselect)})
    data = yaml.safe_load(manifest.read_text())
    change(data["runs"][0])
    manifest.write_text(yaml.safe_dump(data, sort_keys=False))
    with pytest.raises(ValueError, match=message):
        load_manifest(manifest)


def test_append_and_refresh_require_the_reselect_runs_of_the_store_and_append_keeps_them(syn: Synthetic) -> None:
    first = syn.run_names[0]
    reselect = _write_reselect(syn, first, _accessions(syn, first)[:4])
    store = _build(_manifest(syn, "prefix", [first], {first: _path(syn, reselect)}), syn.root / "store" / "p.duckdb")
    without_reselect = _manifest(syn, "plain", syn.run_names, {})
    with pytest.raises(BuildError, match="with the same reselect runs"):
        build_append(load_manifest(without_reselect), store, syn.root / "store" / "a.duckdb", workers=1)
    with pytest.raises(BuildError, match="with the same reselect runs"):
        build_refresh(load_manifest(_manifest(syn, "plain1", [first], {})), store, syn.root / "store" / "r.duckdb")
    both = _manifest(syn, "both", syn.run_names, {first: _path(syn, reselect)})
    appended = syn.root / "store" / "a.duckdb"
    assert build_append(load_manifest(both), store, appended, workers=1).ok
    full = _build(both, syn.root / "store" / "f.duckdb")
    assert _snapshot(appended) == _snapshot(full)
    assert sorted(p.name for p in (syn.root / "store").iterdir()) == ["a.duckdb", "f.duckdb", "p.duckdb"]
