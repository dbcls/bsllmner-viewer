"""Verification of a built store before publication."""

from __future__ import annotations

from dataclasses import dataclass

import duckdb

from bsllmner_viewer.store.schema import DERIVED_TABLES, RAW_TABLES


@dataclass(frozen=True, slots=True)
class Verification:
    ok: bool
    problems: tuple[str, ...]
    counts: dict[str, int]


def verify(con: duckdb.DuckDBPyConnection) -> Verification:
    problems: list[str] = []
    existing = {row[0] for row in con.execute("SELECT table_name FROM duckdb_tables()").fetchall()}
    for table in (*RAW_TABLES, *DERIVED_TABLES):
        if table not in existing:
            problems.append(f"missing table {table}")
    if problems:
        return Verification(False, tuple(problems), {})
    counts = {
        table: int(con.execute(f"SELECT count(*) FROM {table}").fetchone()[0])  # type: ignore[index]
        for table in ("run", "entry", "biosample", "annotation", "record", "term", "term_closure")
    }
    unstored = con.execute(
        "SELECT count(*) FROM entry WHERE accession NOT IN (SELECT accession FROM biosample)"
    ).fetchone()
    if unstored and unstored[0]:
        problems.append(f"{unstored[0]} entries are neither stored nor superseded")
    duplicated = con.execute(
        "SELECT count(*) FROM (SELECT accession FROM biosample GROUP BY accession HAVING count(*) > 1)"
    ).fetchone()
    if duplicated and duplicated[0]:
        problems.append(f"{duplicated[0]} BioSamples are stored more than once")
    if counts["record"] == 0:
        problems.append("the population is empty")
    for table, relation in (("biosample_bioproject", "BioSample-BioProject"), ("sra_run", "experiment-run")):
        row = con.execute(f"SELECT count(*) FROM {table}").fetchone()
        if not row or not row[0]:
            problems.append(f"no {relation} relation was read from the DBLink data")
    return Verification(not problems, tuple(problems), counts)
