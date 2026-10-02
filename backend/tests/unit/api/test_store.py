from __future__ import annotations

import shutil
from pathlib import Path

import duckdb
import pytest

from bsllmner_viewer.api.store import Store
from bsllmner_viewer.store.schema import SCHEMA_VERSION


def test_store_opens_a_store_of_the_current_schema_version(store_path: Path) -> None:
    store = Store(store_path)
    try:
        assert store.fields
    finally:
        store.close()


@pytest.mark.parametrize("value", [str(SCHEMA_VERSION - 1), str(SCHEMA_VERSION + 1), None])
def test_store_refuses_another_schema_version(store_path: Path, tmp_path: Path, value: str | None) -> None:
    copy = tmp_path / "other.duckdb"
    shutil.copy(store_path, copy)
    con = duckdb.connect(str(copy))
    if value is None:
        con.execute("DELETE FROM store_meta WHERE key = 'schema_version'")
    else:
        con.execute("UPDATE store_meta SET value = ? WHERE key = 'schema_version'", [value])
    con.close()
    with pytest.raises(RuntimeError, match="store schema version"):
        Store(copy)


def test_store_refuses_a_store_written_with_schema_version_2(store_path: Path, tmp_path: Path) -> None:
    copy = tmp_path / "v2.duckdb"
    shutil.copy(store_path, copy)
    con = duckdb.connect(str(copy))
    con.execute("UPDATE store_meta SET value = '2' WHERE key = 'schema_version'")
    con.close()
    with pytest.raises(RuntimeError, match="store schema version 2"):
        Store(copy)
