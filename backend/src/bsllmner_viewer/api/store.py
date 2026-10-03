"""Read-only access to a store for the api."""

from __future__ import annotations

import hashlib
import os
import shutil
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import duckdb
import orjson

from bsllmner_viewer.api.limits import DeadlineCursor, Gate, Limits, query_clock
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.store.organisms import ORGANISM_NAMES
from bsllmner_viewer.store.version import DatasetVersion, SchemaVersionError, read_version, require_current_schema

STORE_ENV = "BSLLMNER_VIEWER_STORE"


@dataclass(frozen=True, slots=True)
class FieldInfo:
    name: str
    position: int
    multi_valued: bool
    ontologies: tuple[str, ...]


class Store:
    """One opened store: a read-only DuckDB connection plus what every request needs from it.

    The connection is configured once, and then its configuration is locked: DuckDB cannot read or write files other
    than the store, and cannot load an extension. DuckDB shares one configuration among the connections to the same
    file in a process, so a second `Store` on a file that is open already keeps the configuration of the first.
    """

    def __init__(self, path: Path, limits: Limits | None = None) -> None:
        self.path = path
        self.limits = limits or Limits.from_env()
        self._con = duckdb.connect(str(path), read_only=True)
        self._queries = Gate(self.limits.max_queries, self.limits.queue_timeout)
        self._exports = Gate(self.limits.max_exports, self.limits.queue_timeout)
        self._temp_directory: Path | None = None
        try:
            self._configure()
            _require_current_schema(self._con, path)
        except BaseException:
            self._con.close()
            raise
        self._fd = os.open(path, os.O_RDONLY)
        self._signature = self._file_signature()
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
        self.field_set = FieldSet(tuple(f.name for f in self.fields), tuple(self.version.target_assays))
        self.organism_names: dict[int, str | None] = {
            int(organism_id): name for organism_id, name in self._con.execute(ORGANISM_NAMES).fetchall()
        }
        self.target_assays: tuple[str, ...] = tuple(self.version.target_assays)

    def _configure(self) -> None:
        locked = self._con.execute("SELECT value FROM duckdb_settings() WHERE name = 'lock_configuration'").fetchone()
        if locked is not None and str(locked[0]).lower() == "true":
            return
        limits = self.limits
        threads = os.environ.get("BSLLMNER_VIEWER_THREADS")
        if threads:
            self._con.execute(f"SET threads = {int(threads)}")
        # Each worker spills to a directory of its own, because DuckDB names its temporary files by a counter.
        _remove_stale_temp_directories(limits.temp_directory)
        temp = limits.temp_directory / f"worker-{os.getpid()}"
        shutil.rmtree(temp, ignore_errors=True)
        temp.mkdir(parents=True, exist_ok=True)
        self._temp_directory = temp
        self._con.execute(f"SET memory_limit = '{limits.memory_limit}'")
        self._con.execute(f"SET temp_directory = '{_quote(str(temp))}'")
        self._con.execute(f"SET max_temp_directory_size = '{limits.max_temp_size}'")
        for setting in (
            "enable_external_access = false",
            "allow_community_extensions = false",
            "autoinstall_known_extensions = false",
            "autoload_known_extensions = false",
            "lock_configuration = true",
        ):
            self._con.execute(f"SET {setting}")

    @contextmanager
    def cursor(self, *, heavy: bool = False) -> Iterator[duckdb.DuckDBPyConnection]:
        """A cursor for one request. A heavy request takes a slot, and its queries share the time limit."""
        if not heavy:
            plain = self._con.cursor()
            try:
                yield plain
            finally:
                plain.close()
            return
        with self._queries.slot():
            raw = self._con.cursor()
            cur = DeadlineCursor(raw)
            try:
                with query_clock(cur, self.limits.query_timeout):
                    yield cast(duckdb.DuckDBPyConnection, cur)
            finally:
                raw.close()

    def open_export(self) -> ExportSession:
        """Take an export slot and a cursor, or raise the `server-busy` error."""
        self._exports.acquire()
        try:
            return ExportSession(DeadlineCursor(self._con.cursor()), self._exports, self.limits.query_timeout)
        except BaseException:
            self._exports.release()
            raise

    def _file_signature(self) -> tuple[int, int]:
        stat = os.fstat(self._fd)
        return stat.st_size, stat.st_mtime_ns

    def file_unchanged(self) -> bool:
        """Whether the store file has the size and the modification time that it had when the store opened it."""
        try:
            return self._file_signature() == self._signature
        except OSError:
            return False

    def close(self) -> None:
        self._con.close()
        if self._fd >= 0:
            os.close(self._fd)
            self._fd = -1
        if self._temp_directory is not None:
            shutil.rmtree(self._temp_directory, ignore_errors=True)


class ExportSession:
    """The cursor and the export slot of one export, which can outlive the request function.

    The time limit applies to one read at a time (`timed`): a page of entries, or the first read of an accession list.
    An export reads for as long as its client does, so the time of the client does not count.
    `close` can be called again.
    """

    def __init__(self, cursor: DeadlineCursor, gate: Gate, timeout: float) -> None:
        self._deadline = cursor
        self.cursor = cast(duckdb.DuckDBPyConnection, cursor)
        self._gate = gate
        self._timeout = timeout
        self._closed = False

    def timed(self) -> AbstractContextManager[None]:
        return query_clock(self._deadline, self._timeout)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self.cursor.close()
        finally:
            self._gate.release()


def _remove_stale_temp_directories(base: Path) -> None:
    """Remove the temporary directories of workers that are gone, for example one that the system killed.

    A directory is stale when no process of this container has the pid in its name. Without `/proc`, nothing is
    removed.
    """
    if not Path("/proc/self").exists() or not base.is_dir():
        return
    for entry in base.glob("worker-*"):
        pid = entry.name.removeprefix("worker-")
        if pid.isdigit() and not Path(f"/proc/{pid}").exists():
            shutil.rmtree(entry, ignore_errors=True)


def _quote(value: str) -> str:
    return value.replace("'", "''")


def _require_current_schema(con: duckdb.DuckDBPyConnection, path: Path) -> None:
    try:
        require_current_schema(con, path)
    except SchemaVersionError:
        con.close()
        raise


def store_path_from_env() -> Path:
    value = os.environ.get(STORE_ENV)
    if not value:
        raise RuntimeError(f"{STORE_ENV} is not set")
    return Path(value)
