from __future__ import annotations

import json
from pathlib import Path

import duckdb
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.build.ingest import build_append, build_full
from bsllmner_viewer.build.manifest import load_manifest
from bsllmner_viewer.store.schema import DERIVED_TABLES, RAW_TABLES
from tests.synthetic import FIELDS, Synthetic, generate

# What differs between a store that excludes a field and a store whose select configuration lacks the field.
_CONFIG_DEPENDENT = {"store_meta": "excluded_fields", "run": "select_config_sha256"}

_excluded = st.lists(st.sampled_from(list(FIELDS)), max_size=len(FIELDS) + 2)


def _snapshot(path: Path, *, config_dependent: bool = True) -> dict[str, list[tuple[object, ...]]]:
    """Every table of a store without the times of the build, and optionally without `_CONFIG_DEPENDENT`."""
    con = duckdb.connect(str(path), read_only=True)
    try:
        out: dict[str, list[tuple[object, ...]]] = {}
        for table in (*RAW_TABLES, *DERIVED_TABLES):
            if table == "store_meta":
                skipped = ["created_at"] if config_dependent else ["created_at", _CONFIG_DEPENDENT["store_meta"]]
                rows = con.execute(
                    f"SELECT key, value FROM store_meta WHERE key NOT IN ({', '.join('?' for _ in skipped)})", skipped
                ).fetchall()
            else:
                skipped = ["ingested_at"] if config_dependent else ["ingested_at", _CONFIG_DEPENDENT.get(table, "")]
                columns = [c[0] for c in con.execute(f"DESCRIBE {table}").fetchall() if c[0] not in skipped]
                rows = con.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
            out[table] = sorted(rows, key=repr)
        return out
    finally:
        con.close()


def _excluding(manifest: Path, fields: list[str], out: Path) -> Path:
    head, _, tail = manifest.read_text().partition("runs:\n")
    out.write_text(f"{head}excluded_fields: {json.dumps(fields)}\nruns:\n{tail}")
    return out


def _full(manifest: Path, out: Path) -> Path:
    result = build_full(load_manifest(manifest), out, workers=1)
    assert result.ok, result.problems
    return out


def _fields(path: Path) -> list[str]:
    con = duckdb.connect(str(path), read_only=True)
    try:
        return [str(r[0]) for r in con.execute("SELECT name FROM field ORDER BY position").fetchall()]
    finally:
        con.close()


def _dataset(tmp_path_factory: object, seed: int) -> Synthetic:
    root = tmp_path_factory.mktemp("excluded")  # type: ignore[attr-defined]
    return generate(root, seed=seed, n_biosamples=24, n_runs=3, overlap=0.4)


@settings(max_examples=6)
@given(seed=st.integers(0, 10_000), excluded=_excluded)
def test_build_with_excluded_fields_equals_a_build_whose_select_configuration_lacks_the_fields(
    seed: int, excluded: list[str], tmp_path_factory: object
) -> None:
    syn = _dataset(tmp_path_factory, seed)
    excluding = _full(_excluding(syn.manifest, excluded, syn.root / "excluding.yaml"), syn.root / "excluding.duckdb")
    assert _fields(excluding) == [f for f in FIELDS if f not in excluded]
    config = syn.root / "config" / "select-config.json"
    config.write_text(json.dumps({"fields": {name: spec for name, spec in FIELDS.items() if name not in excluded}}))
    lacking = _full(syn.manifest, syn.root / "lacking.duckdb")
    assert _snapshot(excluding, config_dependent=False) == _snapshot(lacking, config_dependent=False)


@settings(max_examples=6)
@given(seed=st.integers(0, 10_000), excluded=_excluded, k=st.integers(1, 2))
def test_full_build_with_excluded_fields_equals_a_prefix_build_plus_an_append_with_the_same_excluded_fields(
    seed: int, excluded: list[str], k: int, tmp_path_factory: object
) -> None:
    syn = _dataset(tmp_path_factory, seed)
    manifest = _excluding(syn.manifest, excluded, syn.root / "excluding.yaml")
    full = _full(manifest, syn.root / "full.duckdb")
    prefix_manifest = syn.manifest_with_runs(syn.run_names[:k], syn.root / "prefix-runs.yaml")
    prefix = _full(_excluding(prefix_manifest, excluded, syn.root / "prefix.yaml"), syn.root / "prefix.duckdb")
    appended = syn.root / "appended.duckdb"
    assert build_append(load_manifest(manifest), prefix, appended, workers=1).ok
    assert _snapshot(appended) == _snapshot(full)
