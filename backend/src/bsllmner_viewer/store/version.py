"""Dataset version information recorded in a store and returned with every api response."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb
import orjson
from pydantic import BaseModel, ConfigDict

from bsllmner_viewer.store.schema import SCHEMA_VERSION


class RunVersion(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    mk2_version: str
    select_config_sha256: str


class OntologyVersion(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    checksums: list[str]
    snapshot_date: str | None


class ReferenceVersion(BaseModel):
    model_config = ConfigDict(frozen=True)

    sra_experiments: str | None
    dblink: str | None
    bioprojects: str | None
    chip_atlas: str | None


class DatasetVersion(BaseModel):
    """Identifies one store: dataset name, creation time, model, run versions, checksums, and snapshots."""

    model_config = ConfigDict(frozen=True)

    name: str
    created_at: str
    model: str
    target_assays: list[str]
    runs: list[RunVersion]
    ontologies: list[OntologyVersion]
    reference_snapshots: ReferenceVersion


def read_meta(con: duckdb.DuckDBPyConnection, key: str) -> Any:
    row = con.execute("SELECT value FROM store_meta WHERE key = ?", [key]).fetchone()
    return orjson.loads(row[0]) if row else None


def write_meta(con: duckdb.DuckDBPyConnection, key: str, value: Any) -> None:
    con.execute("INSERT OR REPLACE INTO store_meta VALUES (?, ?)", [key, orjson.dumps(value).decode()])


def read_version(con: duckdb.DuckDBPyConnection) -> DatasetVersion:
    runs = [
        RunVersion(name=name, mk2_version=mk2, select_config_sha256=sha)
        for name, mk2, sha in con.execute(
            "SELECT name, mk2_version, select_config_sha256 FROM run ORDER BY manifest_index"
        ).fetchall()
    ]
    ontologies = [
        OntologyVersion(name=name, checksums=list(checksums), snapshot_date=snapshot)
        for name, checksums, snapshot in con.execute(
            "SELECT name, checksums, snapshot_date FROM ref_ontology ORDER BY name"
        ).fetchall()
    ]
    snapshots = read_meta(con, "reference_snapshots") or {}
    return DatasetVersion(
        name=str(read_meta(con, "name")),
        created_at=str(read_meta(con, "created_at")),
        model=str(read_meta(con, "model")),
        target_assays=list(read_meta(con, "target_assays") or []),
        runs=runs,
        ontologies=ontologies,
        reference_snapshots=ReferenceVersion(
            sra_experiments=snapshots.get("sra_experiments"),
            dblink=snapshots.get("dblink"),
            bioprojects=snapshots.get("bioprojects"),
            chip_atlas=snapshots.get("chip_atlas"),
        ),
    )


class SchemaVersionError(RuntimeError):
    """A store was written with another version of the store schema than the one this code reads."""


def require_current_schema(con: duckdb.DuckDBPyConnection, path: Path, *, catalog: str | None = None) -> None:
    """Raise SchemaVersionError unless the store has the current schema version.

    `catalog` is the name under which the store is attached to the connection, or None when it is the connection's
    own database.
    """
    table = "store_meta" if catalog is None else f"{catalog}.store_meta"
    try:
        row = con.execute(f"SELECT value FROM {table} WHERE key = 'schema_version'").fetchone()
        found = None if row is None else int(orjson.loads(row[0]))
    except (duckdb.CatalogException, ValueError):
        found = None
    if found != SCHEMA_VERSION:
        raise SchemaVersionError(
            f"{path} has store schema version {found}, and this code reads version {SCHEMA_VERSION}; "
            "write a new store with a full build"
        )
