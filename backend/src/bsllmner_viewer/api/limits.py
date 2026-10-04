"""Resource limits of one api worker: DuckDB memory and temporary files, the time of a query, and concurrent queries."""

from __future__ import annotations

import contextlib
import math
import os
import re
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb

from bsllmner_viewer.api.problems import RETRY_AFTER_SECONDS, ApiError

MEMORY_LIMIT_ENV = "BSLLMNER_VIEWER_MEMORY_LIMIT"
TEMP_DIRECTORY_ENV = "BSLLMNER_VIEWER_TEMP_DIRECTORY"
MAX_TEMP_SIZE_ENV = "BSLLMNER_VIEWER_MAX_TEMP_SIZE"
QUERY_TIMEOUT_ENV = "BSLLMNER_VIEWER_QUERY_TIMEOUT"
MAX_QUERIES_ENV = "BSLLMNER_VIEWER_MAX_QUERIES"
MAX_EXPORTS_ENV = "BSLLMNER_VIEWER_MAX_EXPORTS"
QUEUE_TIMEOUT_ENV = "BSLLMNER_VIEWER_QUEUE_TIMEOUT"

QUEUE_PER_SLOT = 4
RESEND_SECONDS = 0.02
# The threads of the server that run the requests. Every request that waits for a slot holds one.
SERVER_THREADS = 128

# A size that DuckDB reads, with at most one ASCII space between the number and the unit.
_SIZE = re.compile(r"[0-9]+(?:\.[0-9]+)? ?(?:B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)")


@dataclass(frozen=True, slots=True)
class Limits:
    """Limits of one worker. Every worker is a process of its own, so every limit applies to each worker."""

    memory_limit: str = "4GB"
    temp_directory: Path = Path(tempfile.gettempdir()) / "bsllmner-viewer"
    max_temp_size: str = "20GB"
    query_timeout: float = 60.0
    max_queries: int = 8
    max_exports: int = 2
    queue_timeout: float = 10.0
    export_batch: int = 1000

    def __post_init__(self) -> None:
        for name, value in (("memory limit", self.memory_limit), ("temporary directory size", self.max_temp_size)):
            if not _SIZE.fullmatch(value):
                raise ValueError(f"the {name} must be a size such as 4GB, got {value!r}")
        if not (math.isfinite(self.query_timeout) and math.isfinite(self.queue_timeout)):
            raise ValueError("the query timeout and the queue timeout must be finite numbers of seconds")
        if self.query_timeout <= 0 or self.queue_timeout < 0:
            raise ValueError("the query timeout must be positive and the queue timeout must not be negative")
        if self.max_queries < 1 or self.max_exports < 1 or self.export_batch < 1:
            raise ValueError("the numbers of concurrent queries and exports must be at least 1")

    @classmethod
    def from_env(cls) -> Limits:
        default = cls()
        env = os.environ
        try:
            return cls(
                memory_limit=env.get(MEMORY_LIMIT_ENV) or default.memory_limit,
                temp_directory=Path(env.get(TEMP_DIRECTORY_ENV) or default.temp_directory),
                max_temp_size=env.get(MAX_TEMP_SIZE_ENV) or default.max_temp_size,
                query_timeout=float(env.get(QUERY_TIMEOUT_ENV) or default.query_timeout),
                max_queries=int(env.get(MAX_QUERIES_ENV) or default.max_queries),
                max_exports=int(env.get(MAX_EXPORTS_ENV) or default.max_exports),
                queue_timeout=float(env.get(QUEUE_TIMEOUT_ENV) or default.queue_timeout),
            )
        except ValueError as e:
            raise RuntimeError(f"invalid resource limit: {e}") from e


def busy() -> ApiError:
    return ApiError(
        "server-busy",
        503,
        "too many requests are running; retry after a few seconds",
        headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
    )


class Gate:
    """At most `slots` holders at a time. A request without a slot waits up to `wait` seconds.

    A waiting request holds a thread of the server, so no more than `QUEUE_PER_SLOT * slots` requests wait. A request
    that finds the queue full fails at once.
    """

    def __init__(self, slots: int, wait: float) -> None:
        self._slots = threading.BoundedSemaphore(slots)
        self._wait = wait
        self._max_waiting = QUEUE_PER_SLOT * slots
        self._waiting = 0
        self._lock = threading.Lock()

    def acquire(self) -> None:
        if self._slots.acquire(blocking=False):
            return
        with self._lock:
            if self._waiting >= self._max_waiting:
                raise busy()
            self._waiting += 1
        try:
            acquired = self._slots.acquire(timeout=self._wait)
        finally:
            with self._lock:
                self._waiting -= 1
        if not acquired:
            raise busy()

    def release(self) -> None:
        self._slots.release()

    @contextmanager
    def slot(self) -> Iterator[None]:
        self.acquire()
        try:
            yield
        finally:
            self.release()


class DeadlineCursor:
    """A DuckDB cursor that refuses to start a query after the deadline of its clock.

    It stands in for the cursor: every other attribute is the attribute of the cursor.
    """

    def __init__(self, cursor: duckdb.DuckDBPyConnection) -> None:
        self._cursor = cursor
        self.expired = threading.Event()

    def execute(self, *args: Any, **kwargs: Any) -> duckdb.DuckDBPyConnection:
        if self.expired.is_set():
            raise duckdb.InterruptException("the time limit of the request has passed")
        return self._cursor.execute(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cursor, name)


@contextmanager
def query_clock(cur: DeadlineCursor, seconds: float) -> Iterator[None]:
    """End the queries of a cursor that run past `seconds`.

    A query that is running at the deadline ends with `duckdb.InterruptException`, and so does every query that starts
    after the deadline. A query that ended in time is not interrupted, and neither is a later query of the same cursor
    after the clock ends.
    """
    lock = threading.Lock()
    done = threading.Event()
    cur.expired.clear()

    def watch() -> None:
        if done.wait(seconds):
            return
        with lock:
            if done.is_set():
                return
            cur.expired.set()
        # DuckDB drops an interrupt that arrives while the cursor runs no query, so the interrupt is sent again until
        # the clock ends, in case a query starts between the check and the start.
        while True:
            with lock:
                if done.is_set():
                    return
                with contextlib.suppress(Exception):
                    cur.interrupt()
            if done.wait(RESEND_SECONDS):
                return

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        yield
    finally:
        with lock:
            done.set()
            cur.expired.clear()
