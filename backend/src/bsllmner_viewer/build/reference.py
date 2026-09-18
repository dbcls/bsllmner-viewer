"""Readers for reference data other than ontologies."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import duckdb
import orjson


def sql_literal(path: Path) -> str:
    """A path as the body of a single-quoted SQL literal (ATTACH does not take parameters)."""
    return str(path).replace("'", "''")


def jsonl_files(path: Path) -> list[Path]:
    """A single JSONL file, or every `*.jsonl` under a directory (recursively, sorted)."""
    if path.is_dir():
        return sorted(p for p in path.rglob("*.jsonl") if p.is_file())
    return [path]


def read_experiments(path: Path) -> Iterator[tuple[str, str | None]]:
    """(experiment accession, library_strategy) from ddbj-search-converter SRA experiment JSONL."""
    for file in jsonl_files(path):
        if "experiment" not in file.name:
            continue
        with file.open("rb") as f:
            for raw in f:
                if not raw.strip():
                    continue
                doc = orjson.loads(raw)
                if doc.get("type") not in (None, "sra-experiment"):
                    continue
                strategy = doc.get("libraryStrategy")
                first = strategy[0] if isinstance(strategy, list) and strategy else strategy
                yield str(doc["identifier"]), first if isinstance(first, str) and first else None


def read_bioprojects(path: Path) -> Iterator[tuple[str, str | None]]:
    """(BioProject accession, title) from ddbj-search-converter BioProject JSONL."""
    for file in jsonl_files(path):
        with file.open("rb") as f:
            for raw in f:
                if not raw.strip():
                    continue
                doc = orjson.loads(raw)
                title = doc.get("title")
                yield str(doc["identifier"]), title if isinstance(title, str) else None


def read_chip_atlas(path: Path) -> Iterator[tuple[str, str]]:
    """(experiment accession, genome assembly) from the ChIP-Atlas experiment list."""
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 2 and parts[0] and parts[1]:
                yield parts[0], parts[1]


def load_dblink(con: duckdb.DuckDBPyConnection, path: Path) -> dict[str, int]:
    """Copy the DBLink edges that touch the store's BioSamples into the ref_* relation tables.

    The DBLink file is a DuckDB database with a `dbxref` table holding every relation in both directions
    (`accession_type, accession, linked_type, linked_accession`).
    """
    con.execute(f"ATTACH '{sql_literal(path)}' AS dblink (READ_ONLY)")
    try:
        con.execute(
            """
            INSERT INTO ref_biosample_experiment
            SELECT DISTINCT d.accession, d.linked_accession
            FROM dblink.dbxref d
            WHERE d.accession_type = 'biosample' AND d.linked_type = 'sra-experiment'
              AND d.accession IN (SELECT DISTINCT accession FROM entry)
            """
        )
        con.execute(
            """
            INSERT INTO ref_biosample_bioproject
            SELECT DISTINCT d.accession, d.linked_accession
            FROM dblink.dbxref d
            WHERE d.accession_type = 'biosample' AND d.linked_type = 'bioproject'
              AND d.accession IN (SELECT DISTINCT accession FROM entry)
            """
        )
        con.execute(
            """
            INSERT INTO ref_experiment_run
            SELECT DISTINCT d.accession, d.linked_accession
            FROM dblink.dbxref d
            WHERE d.accession_type = 'sra-experiment' AND d.linked_type = 'sra-run'
              AND d.accession IN (SELECT DISTINCT experiment FROM ref_biosample_experiment)
            """
        )
    finally:
        con.execute("DETACH dblink")
    counts: dict[str, int] = {}
    for table in ("ref_biosample_experiment", "ref_biosample_bioproject", "ref_experiment_run"):
        row: Any = con.execute(f"SELECT count(*) FROM {table}").fetchone()
        counts[table] = int(row[0])
    return counts
