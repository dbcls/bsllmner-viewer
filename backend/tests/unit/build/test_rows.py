from __future__ import annotations

import duckdb
import pyarrow as pa

from bsllmner_viewer.build.convert import EVIDENCE_SCHEMA
from bsllmner_viewer.build.derive import _EVIDENCE_SCHEMA
from bsllmner_viewer.build.rows import insert_rows


def test_insert_rows_into_table_with_other_column_order_matches_columns_by_name() -> None:
    con = duckdb.connect()
    con.execute("CREATE TABLE t (b INTEGER, a VARCHAR)")
    insert_rows(con, "t", pa.schema([("a", pa.string()), ("b", pa.int32())]), [("x", 1), ("y", 2)])
    assert con.execute("SELECT a, b FROM t ORDER BY b").fetchall() == [("x", 1), ("y", 2)]


def test_insert_rows_with_no_rows_inserts_nothing() -> None:
    con = duckdb.connect()
    con.execute("CREATE TABLE t (a VARCHAR)")
    insert_rows(con, "t", pa.schema([("a", pa.string())]), [])
    assert con.execute("SELECT count(*) FROM t").fetchone() == (0,)


def test_derived_evidence_schema_is_the_run_evidence_schema_keyed_by_biosample() -> None:
    assert _EVIDENCE_SCHEMA.names == ["biosample", *EVIDENCE_SCHEMA.names[2:]]
    assert [_EVIDENCE_SCHEMA.field(n).type for n in _EVIDENCE_SCHEMA.names[1:]] == [
        EVIDENCE_SCHEMA.field(n).type for n in EVIDENCE_SCHEMA.names[2:]
    ]
