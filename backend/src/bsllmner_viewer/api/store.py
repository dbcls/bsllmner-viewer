"""Read-only access to a store for the api."""

from __future__ import annotations

import hashlib
import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import duckdb
import orjson

from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.store.version import DatasetVersion, read_version

STORE_ENV = "BSLLMNER_VIEWER_STORE"


@dataclass(frozen=True, slots=True)
class FieldInfo:
    name: str
    position: int
    multi_valued: bool
    ontologies: tuple[str, ...]


class Store:
    """One opened store: a read-only DuckDB connection plus what every request needs from it."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._con = duckdb.connect(str(path), read_only=True)
        threads = os.environ.get("BSLLMNER_VIEWER_THREADS")
        if threads:
            self._con.execute(f"SET threads = {int(threads)}")
        self.version: DatasetVersion = read_version(self._con)
        self.version_digest: str = hashlib.sha256(
            orjson.dumps(self.version.model_dump(), option=orjson.OPT_SORT_KEYS)
        ).hexdigest()[:16]
        self.fields: tuple[FieldInfo, ...] = tuple(
            FieldInfo(name=name, position=position, multi_valued=multi, ontologies=tuple(ontologies or ()))
            for name, position, multi, ontologies in self._con.execute(
                """
                SELECT f.name, f.position, f.multi_valued,
                       (SELECT list(DISTINCT t.ontology ORDER BY t.ontology)
                        FROM field_term_count c JOIN term t ON t.term_id = c.term_id
                        WHERE c.field = f.name AND c.n_direct > 0)
                FROM field f ORDER BY f.position
                """
            ).fetchall()
        )
        self.field_set = FieldSet(tuple(f.name for f in self.fields))
        self.target_assays: tuple[str, ...] = tuple(self.version.target_assays)

    @contextmanager
    def cursor(self) -> Iterator[duckdb.DuckDBPyConnection]:
        cur = self._con.cursor()
        try:
            yield cur
        finally:
            cur.close()

    def close(self) -> None:
        self._con.close()


def store_path_from_env() -> Path:
    value = os.environ.get(STORE_ENV)
    if not value:
        raise RuntimeError(f"{STORE_ENV} is not set")
    return Path(value)
