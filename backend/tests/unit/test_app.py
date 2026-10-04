from __future__ import annotations

import logging
import shutil
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.api.app import create_app
from bsllmner_viewer.store.version import SchemaVersionError, write_meta


@pytest.mark.parametrize("value", [None, ""])
def test_create_app_without_a_store_path_or_environment_variable_fails(
    monkeypatch: pytest.MonkeyPatch, value: str | None
) -> None:
    if value is None:
        monkeypatch.delenv("BSLLMNER_VIEWER_STORE", raising=False)
    else:
        monkeypatch.setenv("BSLLMNER_VIEWER_STORE", value)
    with pytest.raises(RuntimeError, match="BSLLMNER_VIEWER_STORE"):
        create_app()


@pytest.mark.parametrize(("level", "prefix"), [(logging.WARNING, "WARNING:"), (logging.ERROR, "ERROR:")])
def test_a_log_line_of_the_api_starts_with_its_level_like_the_lines_of_uvicorn(
    store_path: Path, level: int, prefix: str
) -> None:
    create_app(store_path)
    create_app(store_path)
    logger = logging.getLogger("bsllmner_viewer")
    record = logger.makeRecord("bsllmner_viewer.api.problems", level, __file__, 0, "Query stopped", (), None)
    lines = [handler.format(record) for handler in logger.handlers]
    assert len(lines) == 1
    assert lines[0].startswith(prefix)
    assert lines[0].endswith(" Query stopped")


@pytest.mark.parametrize("kind", ["missing", "not_duckdb", "another_schema_version"])
def test_create_app_stops_for_a_store_that_is_missing_not_duckdb_or_of_another_schema_version(
    store_path: Path, tmp_path: Path, kind: str
) -> None:
    path = tmp_path / "store.duckdb"
    if kind == "not_duckdb":
        path.write_bytes(b"this is not a DuckDB file" * 100)
    elif kind == "another_schema_version":
        shutil.copy(store_path, path)
        con = duckdb.connect(str(path))
        write_meta(con, "schema_version", 0)
        con.close()
    with pytest.raises((duckdb.Error, SchemaVersionError)), TestClient(create_app(path)):
        pass
