"""Readers for reference data other than ontologies."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import duckdb
import orjson

from bsllmner_viewer.build.errors import BuildError


def sql_literal(path: Path) -> str:
    """A path as the body of a single-quoted SQL literal (ATTACH does not take parameters)."""
    return str(path).replace("'", "''")


def jsonl_files(path: Path) -> list[Path]:
    """A single JSONL file, or every `*.jsonl` under a directory (recursively, sorted)."""
    if path.is_dir():
        return sorted(p for p in path.rglob("*.jsonl") if p.is_file())
    return [path]


def _jsonl_objects(file: Path) -> Iterator[tuple[int, dict[str, Any]]]:
    """(line number, object) of each line of a JSONL file. An invalid line raises a BuildError that names the line."""
    with file.open("rb") as f:
        for number, raw in enumerate(f, 1):
            if not raw.strip():
                continue
            try:
                doc = orjson.loads(raw)
            except orjson.JSONDecodeError as e:
                raise BuildError(f"{file.name}:{number}: invalid JSON: {e}") from e
            if not isinstance(doc, dict):
                raise BuildError(f"{file.name}:{number}: the line is not a JSON object")
            yield number, doc


def _identifier(file: Path, number: int, doc: dict[str, Any]) -> str:
    identifier = doc.get("identifier")
    if not isinstance(identifier, str) or not identifier:
        raise BuildError(f"{file.name}:{number}: the identifier is not a non-empty string")
    return identifier


def read_experiments(path: Path) -> Iterator[tuple[str, str | None]]:
    """(experiment accession, library_strategy) from ddbj-search-converter SRA experiment JSONL."""
    for file in jsonl_files(path):
        if "experiment" not in file.name:
            continue
        for number, doc in _jsonl_objects(file):
            if doc.get("type") not in (None, "sra-experiment"):
                continue
            strategy = doc.get("libraryStrategy")
            first = strategy[0] if isinstance(strategy, list) and strategy else strategy
            yield _identifier(file, number, doc), first if isinstance(first, str) and first else None


def read_bioprojects(path: Path) -> Iterator[tuple[str, str | None]]:
    """(BioProject accession, title) from ddbj-search-converter BioProject JSONL."""
    for file in jsonl_files(path):
        for number, doc in _jsonl_objects(file):
            title = doc.get("title")
            yield _identifier(file, number, doc), title if isinstance(title, str) else None


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
