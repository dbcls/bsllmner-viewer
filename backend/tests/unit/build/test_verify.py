from __future__ import annotations

import shutil
from pathlib import Path

import duckdb
import pytest

from bsllmner_viewer.build.verify import verify


def test_verify_accepts_a_built_store(store_con: duckdb.DuckDBPyConnection) -> None:
    result = verify(store_con)
    assert result.ok
    assert result.problems == ()
    assert result.counts["record"] > 0


@pytest.mark.parametrize(
    ("table", "message"),
    [
        ("record", "the population is empty"),
        ("biosample_bioproject", "no BioSample-BioProject relation"),
        ("sra_run", "no experiment-run relation"),
    ],
)
def test_verify_reports_an_empty_table(store_path: Path, tmp_path: Path, table: str, message: str) -> None:
    copy = tmp_path / "emptied.duckdb"
    shutil.copy(store_path, copy)
    con = duckdb.connect(str(copy))
    try:
        con.execute(f"DELETE FROM {table}")
        result = verify(con)
    finally:
        con.close()
    assert not result.ok
    assert any(message in problem for problem in result.problems), result.problems


def test_verify_reports_a_missing_derived_table(store_path: Path, tmp_path: Path) -> None:
    copy = tmp_path / "missing.duckdb"
    shutil.copy(store_path, copy)
    con = duckdb.connect(str(copy))
    try:
        con.execute("DROP TABLE term_search")
        result = verify(con)
    finally:
        con.close()
    assert result.problems == ("missing table term_search",)
