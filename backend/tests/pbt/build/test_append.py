from __future__ import annotations

import hashlib
from pathlib import Path

import duckdb
import pytest

from bsllmner_viewer.build.ingest import build_append, build_full, build_refresh
from bsllmner_viewer.build.manifest import load_manifest
from bsllmner_viewer.store.schema import DERIVED_TABLES, RAW_TABLES
from tests.synthetic import Synthetic, generate

_VOLATILE = {"run": "ingested_at"}


def _snapshot(path: Path) -> dict[str, list[tuple[object, ...]]]:
    con = duckdb.connect(str(path), read_only=True)
    try:
        out: dict[str, list[tuple[object, ...]]] = {}
        for table in (*RAW_TABLES, *DERIVED_TABLES):
            if table == "store_meta":
                rows = con.execute("SELECT key, value FROM store_meta WHERE key <> 'created_at'").fetchall()
            else:
                columns = [c[0] for c in con.execute(f"DESCRIBE {table}").fetchall() if c[0] != _VOLATILE.get(table)]
                rows = con.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
            out[table] = sorted(rows, key=repr)
        return out
    finally:
        con.close()


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.mark.parametrize("k", [1, 2])
def test_full_build_equals_prefix_build_plus_append_and_the_append_leaves_the_prefix_store_unchanged(
    k: int, tmp_path: Path
) -> None:
    synthetic = generate(tmp_path / "syn", seed=1, n_biosamples=60, n_runs=3)
    full = build_full(load_manifest(synthetic.manifest), tmp_path / "full.duckdb", workers=1)
    assert full.ok
    prefix_manifest = synthetic.manifest_with_runs(synthetic.run_names[:k], synthetic.root / f"prefix{k}.yaml")
    prefix = build_full(load_manifest(prefix_manifest), tmp_path / "prefix.duckdb", workers=1)
    assert prefix.ok
    before = _sha256(tmp_path / "prefix.duckdb")
    appended = build_append(
        load_manifest(synthetic.manifest), tmp_path / "prefix.duckdb", tmp_path / "appended.duckdb", workers=1
    )
    assert appended.ok
    assert _sha256(tmp_path / "prefix.duckdb") == before
    assert _snapshot(tmp_path / "appended.duckdb") == _snapshot(tmp_path / "full.duckdb")


def test_refresh_reproduces_a_full_build_and_leaves_the_store_unchanged(
    synthetic: Synthetic, store_path: Path, tmp_path: Path
) -> None:
    before = _sha256(store_path)
    refreshed = build_refresh(load_manifest(synthetic.manifest), store_path, tmp_path / "refreshed.duckdb")
    assert refreshed.ok
    assert _sha256(store_path) == before
    assert _snapshot(tmp_path / "refreshed.duckdb") == _snapshot(store_path)
