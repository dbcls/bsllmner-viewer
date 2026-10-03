"""Insertion of Python rows into a table of the store."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import duckdb
import pyarrow as pa


def insert_rows(con: duckdb.DuckDBPyConnection, table: str, schema: pa.Schema, rows: Sequence[tuple[Any, ...]]) -> None:
    """Insert rows, given as tuples in the order of the schema, into the table by column name."""
    if not rows:
        return
    columns = list(zip(*rows, strict=True))
    batch = pa.table({name: list(col) for name, col in zip(schema.names, columns, strict=True)}, schema=schema)
    con.register("batch_rows", batch)
    try:
        con.execute(f"INSERT INTO {table} BY NAME SELECT * FROM batch_rows")
    finally:
        con.unregister("batch_rows")
