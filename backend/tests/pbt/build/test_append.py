from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from bsllmner_viewer.build.ingest import build_append, build_full, build_refresh
from bsllmner_viewer.build.manifest import load_manifest
from bsllmner_viewer.store.schema import DERIVED_TABLES, RAW_TABLES
from tests.synthetic import Synthetic

_VOLATILE = {"store_meta": None, "run": "ingested_at"}


def _snapshot(path: Path) -> dict[str, list[tuple[object, ...]]]:
    con = duckdb.connect(str(path), read_only=True)
    try:
        out: dict[str, list[tuple[object, ...]]] = {}
        for table in (*RAW_TABLES, *DERIVED_TABLES):
            if table in _VOLATILE and _VOLATILE[table] is None:
                continue
            columns = [c[0] for c in con.execute(f"DESCRIBE {table}").fetchall() if c[0] != _VOLATILE.get(table)]
            out[table] = sorted(con.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall(), key=repr)
        return out
    finally:
        con.close()


@pytest.mark.parametrize("k", [1, 2])
def test_full_build_equals_prefix_build_plus_append(synthetic: Synthetic, k: int, tmp_path: Path) -> None:
    tmp = tmp_path
    all_runs = synthetic.run_names
    full = build_full(load_manifest(synthetic.manifest), tmp / "full.duckdb", workers=1)
    assert full.ok
    prefix_manifest = synthetic.manifest_with_runs(all_runs[:k], tmp / "prefix.yaml")
    prefix = build_full(load_manifest(prefix_manifest), tmp / "prefix.duckdb", workers=1)
    assert prefix.ok
    appended = build_append(
        load_manifest(synthetic.manifest), tmp / "prefix.duckdb", tmp / "appended.duckdb", workers=1
    )
    assert appended.ok
    assert _snapshot(tmp / "appended.duckdb") == _snapshot(tmp / "full.duckdb")


def test_refresh_reproduces_a_full_build(synthetic: Synthetic, store_path: Path, tmp_path: Path) -> None:
    refreshed = build_refresh(load_manifest(synthetic.manifest), store_path, tmp_path / "refreshed.duckdb")
    assert refreshed.ok
    assert _snapshot(tmp_path / "refreshed.duckdb") == _snapshot(store_path)
