"""Resource limits of a worker: DuckDB configuration, the time of a query, concurrent queries, and lengths."""

from __future__ import annotations

import asyncio
import gc
import hashlib
import itertools
import os
import shutil
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import duckdb
import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.api.app import create_app
from bsllmner_viewer.api.limits import DeadlineCursor, Gate, Limits, query_clock
from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.routers.export import _Stream
from bsllmner_viewer.api.store import Store
from tests.api_helpers import call_asgi

PROBLEM_PREFIX = "https://ddbj.nig.ac.jp/problems/"
FOREVER = "SELECT count(*) FROM range(100000000000) a, range(1000000) b"


@pytest.fixture
def copy_of_store(store_path: Path, tmp_path: Path) -> Path:
    """A copy, so that the store is a database of its own, with its own configuration, in this process."""
    copy = tmp_path / "copy.duckdb"
    shutil.copy(store_path, copy)
    return copy


@pytest.fixture
def configured(copy_of_store: Path, tmp_path: Path) -> Iterator[Store]:
    store = Store(copy_of_store, Limits(memory_limit="200MB", temp_directory=tmp_path / "temp", max_temp_size="1GB"))
    yield store
    store.close()


def _setting(store: Store, name: str) -> str:
    with store.cursor() as cur:
        row = cur.execute("SELECT value FROM duckdb_settings() WHERE name = ?", [name]).fetchone()
    assert row is not None
    return str(row[0])


@contextmanager
def _interrupt_after(cursor: Any, seconds: float = 30) -> Iterator[None]:
    """Interrupt a query that the time limit did not stop, so that the test fails instead of running on."""
    timer = threading.Timer(seconds, cursor.interrupt)
    timer.daemon = True
    timer.start()
    try:
        yield
    finally:
        timer.cancel()


def _duckdb_accepts(size: str) -> bool:
    con = duckdb.connect(":memory:")
    try:
        con.execute(f"SET memory_limit = '{size}'")
        con.execute(f"SET max_temp_directory_size = '{size}'")
    except duckdb.Error:
        return False
    finally:
        con.close()
    return True


class TestLimits:
    def test_the_default_limits_are_4gb_memory_20gb_temp_60s_query_10s_queue_8_queries_and_2_exports(self) -> None:
        limits = Limits()
        assert (limits.memory_limit, limits.max_temp_size) == ("4GB", "20GB")
        assert (limits.query_timeout, limits.queue_timeout) == (60, 10)
        assert (limits.max_queries, limits.max_exports) == (8, 2)

    def test_environment_overrides_the_defaults(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        monkeypatch.setenv("BSLLMNER_VIEWER_MEMORY_LIMIT", "2GB")
        monkeypatch.setenv("BSLLMNER_VIEWER_TEMP_DIRECTORY", str(tmp_path))
        monkeypatch.setenv("BSLLMNER_VIEWER_MAX_TEMP_SIZE", "5GB")
        monkeypatch.setenv("BSLLMNER_VIEWER_QUERY_TIMEOUT", "12.5")
        monkeypatch.setenv("BSLLMNER_VIEWER_MAX_QUERIES", "3")
        monkeypatch.setenv("BSLLMNER_VIEWER_MAX_EXPORTS", "1")
        monkeypatch.setenv("BSLLMNER_VIEWER_QUEUE_TIMEOUT", "0")
        assert Limits.from_env() == Limits(
            memory_limit="2GB",
            temp_directory=tmp_path,
            max_temp_size="5GB",
            query_timeout=12.5,
            max_queries=3,
            max_exports=1,
            queue_timeout=0,
        )

    @pytest.mark.parametrize(
        ("name", "value"),
        [
            ("BSLLMNER_VIEWER_MEMORY_LIMIT", "lots"),
            ("BSLLMNER_VIEWER_MEMORY_LIMIT", "4GB'; DROP TABLE x; --"),
            ("BSLLMNER_VIEWER_MAX_TEMP_SIZE", "-1"),
            ("BSLLMNER_VIEWER_QUERY_TIMEOUT", "0"),
            ("BSLLMNER_VIEWER_QUERY_TIMEOUT", "soon"),
            ("BSLLMNER_VIEWER_MAX_QUERIES", "0"),
            ("BSLLMNER_VIEWER_MAX_EXPORTS", "1.5"),
            ("BSLLMNER_VIEWER_QUEUE_TIMEOUT", "-1"),
            ("BSLLMNER_VIEWER_QUERY_TIMEOUT", "nan"),
            ("BSLLMNER_VIEWER_QUERY_TIMEOUT", "inf"),
            ("BSLLMNER_VIEWER_QUEUE_TIMEOUT", "nan"),
            ("BSLLMNER_VIEWER_QUEUE_TIMEOUT", "Infinity"),
            ("BSLLMNER_VIEWER_MEMORY_LIMIT", "4\u3000GB"),
            ("BSLLMNER_VIEWER_MAX_TEMP_SIZE", "4\tGB"),
        ],
    )
    def test_an_invalid_value_stops_the_start(self, monkeypatch: pytest.MonkeyPatch, name: str, value: str) -> None:
        monkeypatch.setenv(name, value)
        with pytest.raises(RuntimeError, match="invalid resource limit"):
            Limits.from_env()

    @pytest.mark.parametrize(
        "name",
        [
            "BSLLMNER_VIEWER_MEMORY_LIMIT",
            "BSLLMNER_VIEWER_TEMP_DIRECTORY",
            "BSLLMNER_VIEWER_MAX_TEMP_SIZE",
            "BSLLMNER_VIEWER_QUERY_TIMEOUT",
            "BSLLMNER_VIEWER_MAX_QUERIES",
            "BSLLMNER_VIEWER_MAX_EXPORTS",
            "BSLLMNER_VIEWER_QUEUE_TIMEOUT",
        ],
    )
    def test_an_empty_environment_value_selects_the_default(self, monkeypatch: pytest.MonkeyPatch, name: str) -> None:
        monkeypatch.setenv(name, "")
        assert Limits.from_env() == Limits()

    @pytest.mark.parametrize(
        ("number", "unit"),
        [
            ("536870912", "B"),
            ("524288", "KB"),
            ("512", "MB"),
            ("1", "GB"),
            ("1", "TB"),
            ("524288", "KiB"),
            ("512", "MiB"),
            ("1", "GiB"),
            ("1", "TiB"),
        ],
    )
    def test_a_size_with_each_documented_unit_is_accepted_by_the_api_and_by_duckdb(
        self, number: str, unit: str
    ) -> None:
        size = number + unit
        limits = Limits(memory_limit=size, max_temp_size=size)
        assert (limits.memory_limit, limits.max_temp_size) == (size, size)
        assert _duckdb_accepts(size)

    @pytest.mark.parametrize(
        ("number", "gap", "unit"),
        list(
            itertools.product(
                ["4", "1.5", "0.25"],
                ["", " ", "\t", "\u3000", "\xa0"],
                ["B", "KB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB", "gb"],
            )
        ),
    )
    def test_every_size_that_the_api_accepts_is_a_size_that_duckdb_accepts(
        self, number: str, gap: str, unit: str
    ) -> None:
        size = number + gap + unit
        try:
            Limits(memory_limit=size)
        except ValueError:
            return
        assert _duckdb_accepts(size), size

    def test_the_default_temporary_directory_is_in_the_system_temporary_directory(self) -> None:
        assert Limits().temp_directory.parent == Path(tempfile.gettempdir())


_READ_REQUESTS: tuple[tuple[str, dict[str, Any]], ...] = (
    ("/api/dataset", {}),
    ("/api/entries/biosample", {"q": "hypoxia"}),
    ("/api/crosstab", {"row": "disease", "col": "tissue", "unit": "bioproject"}),
    ("/api/trend", {"field": "organism_id"}),
    ("/api/terms", {"query": "cancer"}),
    ("/api/export/entries/biosample", {"format": "tsv"}),
    ("/api/export/accessions/sra-run", {}),
)


class TestStoreConfiguration:
    def test_memory_and_temporary_files_are_limited(self, configured: Store, tmp_path: Path) -> None:
        memory = duckdb.connect(":memory:")
        memory.execute("SET memory_limit = '200MB'")
        expected = memory.execute("SELECT value FROM duckdb_settings() WHERE name = 'memory_limit'").fetchone()
        assert expected is not None
        assert _setting(configured, "memory_limit") == expected[0]
        assert _setting(configured, "temp_directory").startswith(str(tmp_path / "temp"))
        assert (tmp_path / "temp").is_dir()

    def test_a_query_that_needs_more_than_the_memory_limit_spills_to_the_temporary_directory(
        self, copy_of_store: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Every thread of DuckDB holds buffers, so two threads keep the sort within the limit however busy the host is.
        monkeypatch.setenv("BSLLMNER_VIEWER_THREADS", "2")
        store = Store(
            copy_of_store, Limits(memory_limit="200MB", temp_directory=tmp_path / "temp", max_temp_size="1GB")
        )
        try:
            with store.cursor() as cur:
                row = cur.execute("SELECT count(*) FROM (SELECT i, hash(i) h FROM range(20000000) t(i) ORDER BY h)")
                assert row.fetchone() == (20000000,)
        finally:
            store.close()

    def test_a_query_that_needs_more_than_the_temporary_size_is_an_out_of_memory_error(
        self, copy_of_store: Path, tmp_path: Path
    ) -> None:
        store = Store(copy_of_store, Limits(memory_limit="100MB", temp_directory=tmp_path / "t", max_temp_size="50MB"))
        try:
            with store.cursor() as cur, pytest.raises(duckdb.OutOfMemoryException):
                cur.execute("SELECT count(*) FROM (SELECT i, hash(i) h FROM range(20000000) t(i) ORDER BY h)")
        finally:
            store.close()

    @pytest.mark.parametrize(
        "sql",
        [
            "SELECT * FROM read_text('/etc/hostname')",
            "SELECT * FROM read_csv('/etc/hostname')",
            "COPY (SELECT 1) TO '/tmp/bsllmner-viewer-test.csv'",
            "ATTACH '/tmp/bsllmner-viewer-other.duckdb' AS other",
            "INSTALL httpfs",
            "LOAD httpfs",
            "SET enable_external_access = true",
            "SET threads = 1",
            "SET allow_community_extensions = true",
        ],
    )
    def test_files_extensions_and_the_configuration_are_out_of_reach(self, configured: Store, sql: str) -> None:
        with configured.cursor() as cur, pytest.raises((duckdb.PermissionException, duckdb.InvalidInputException)):
            cur.execute(sql)

    def test_the_configuration_is_locked(self, configured: Store) -> None:
        assert _setting(configured, "lock_configuration") == "true"
        assert _setting(configured, "enable_external_access") == "false"

    def test_a_second_store_on_the_same_file_keeps_the_first_configuration(
        self, configured: Store, copy_of_store: Path, tmp_path: Path
    ) -> None:
        second = Store(copy_of_store, Limits(memory_limit="1GB", temp_directory=tmp_path / "other"))
        try:
            assert _setting(second, "memory_limit") == _setting(configured, "memory_limit")
            assert not (tmp_path / "other").exists()
        finally:
            second.close()

    def test_closing_the_store_removes_its_temporary_directory(self, copy_of_store: Path, tmp_path: Path) -> None:
        store = Store(copy_of_store, Limits(temp_directory=tmp_path / "temp"))
        assert any((tmp_path / "temp").iterdir())
        store.close()
        assert not any((tmp_path / "temp").iterdir())

    def test_an_unwritable_temporary_directory_stops_the_start(self, copy_of_store: Path, tmp_path: Path) -> None:
        blocker = tmp_path / "file"
        blocker.write_text("x")
        with pytest.raises(RuntimeError, match="cannot create the temporary directory"):
            Store(copy_of_store, Limits(temp_directory=blocker / "temp"))

    def test_a_temporary_directory_of_another_owner_stops_the_start_with_the_owner_and_the_uid_of_the_api(
        self, copy_of_store: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A privileged user can create a directory anywhere, so the test makes Path.mkdir raise PermissionError.
        base = tmp_path / "temp"
        base.mkdir()

        def refuse(self: Path, *args: Any, **kwargs: Any) -> None:
            raise PermissionError(13, "Permission denied", str(self))

        monkeypatch.setattr(Path, "mkdir", refuse)
        with pytest.raises(RuntimeError) as raised:
            Store(copy_of_store, Limits(temp_directory=base))
        message = str(raised.value)
        assert "\n" not in message
        assert str(base / "worker-") in message
        assert f"{base} belongs to uid {base.stat().st_uid}" in message
        assert "drwx" in message
        assert f"runs as uid {os.getuid()}" in message

    def test_the_api_reads_every_kind_of_request_under_the_configuration(self, configured: Store) -> None:
        with TestClient(create_app(configured.path)) as client:
            for path, params in _READ_REQUESTS:
                assert client.get(path, params=params).status_code == 200, path

    @pytest.mark.parametrize(
        "sql",
        [
            "CREATE TABLE written (x INTEGER)",
            "INSERT INTO entry SELECT * FROM entry LIMIT 1",
            "DELETE FROM biosample",
            "DROP TABLE term",
        ],
    )
    def test_store_opens_the_file_read_only_so_that_a_write_is_an_error(self, configured: Store, sql: str) -> None:
        with configured.cursor() as cur, pytest.raises(duckdb.Error):
            cur.execute(sql)

    def test_a_request_does_not_change_the_store_file(self, configured: Store) -> None:
        def digest() -> str:
            return hashlib.sha256(configured.path.read_bytes()).hexdigest()

        before = digest()
        with TestClient(create_app(configured.path)) as client:
            for path, params in _READ_REQUESTS:
                assert client.get(path, params=params).status_code == 200, path
            select = {"q": "hypoxia", "clauses": [{"field": "disease", "value": "MONDO:0007254"}]}
            assert client.post("/api/dsl/select", json=select).status_code == 200
            assert client.post("/api/dsl/keyword", json={"q": "hypoxia", "keyword": "cancer"}).status_code == 200
        assert digest() == before


class TestGate:
    def test_a_request_waits_for_a_slot_and_gets_it(self) -> None:
        gate = Gate(1, wait=5)
        order: list[str] = []
        gate.acquire()

        waiting = threading.Event()

        def second() -> None:
            waiting.set()
            with gate.slot():
                order.append("second")

        thread = threading.Thread(target=second)
        thread.start()
        assert waiting.wait(5)
        order.append("first released")
        gate.release()
        thread.join(5)
        assert order == ["first released", "second"]

    def test_a_request_that_waits_too_long_is_busy(self) -> None:
        gate = Gate(1, wait=0.1)
        gate.acquire()
        started = time.monotonic()
        with pytest.raises(ApiError) as caught:
            gate.acquire()
        assert 0.09 <= time.monotonic() - started < 2
        assert caught.value.status == 503
        assert caught.value.slug == "server-busy"
        assert caught.value.headers is not None
        assert int(caught.value.headers["Retry-After"]) > 0

    @pytest.mark.parametrize("slots", [1, 2])
    def test_a_gate_holds_four_waiting_requests_per_slot_and_refuses_the_next_at_once(self, slots: int) -> None:
        gate = Gate(slots, wait=10)
        for _ in range(slots):
            gate.acquire()
        failures: list[BaseException] = []
        got: list[int] = []
        entering = [threading.Event() for _ in range(4 * slots)]

        def wait_for_a_slot(i: int) -> None:
            entering[i].set()
            try:
                gate.acquire()
            except BaseException as e:
                failures.append(e)
            else:
                got.append(i)

        threads = [threading.Thread(target=wait_for_a_slot, args=(i,)) for i in range(4 * slots)]
        for thread in threads:
            thread.start()
        for event in entering:
            assert event.wait(5)
        refused: list[ApiError] = []

        def one_more() -> None:
            try:
                gate.acquire()
            except ApiError as e:
                refused.append(e)

        probe = threading.Thread(target=one_more)
        started = time.monotonic()
        probe.start()
        probe.join(1)
        assert not probe.is_alive()
        assert time.monotonic() - started < 1
        assert len(refused) == 1
        assert refused[0].status == 503
        for taken in range(1, 4 * slots + 1):
            gate.release()
            # The next release waits until a waiting request has taken this slot, or the gate would be over-released.
            deadline = time.monotonic() + 5
            while len(got) < taken and time.monotonic() < deadline:
                time.sleep(0.005)
        for thread in threads:
            thread.join(5)
        assert failures == []
        assert sorted(got) == list(range(4 * slots))

    def test_a_released_slot_can_be_taken_again(self) -> None:
        gate = Gate(2, wait=0)
        for _ in range(10):
            with gate.slot(), gate.slot():
                pass


class TestQueryClock:
    def test_a_query_that_runs_past_the_limit_is_interrupted(self) -> None:
        con = duckdb.connect(":memory:")
        cur = DeadlineCursor(con.cursor())
        started = time.monotonic()
        with _interrupt_after(cur), query_clock(cur, 0.2), pytest.raises(duckdb.InterruptException):
            cur.execute(FOREVER).fetchone()
        assert time.monotonic() - started < 5

    def test_a_deadline_between_two_queries_stops_the_query_that_starts_after_it(self) -> None:
        con = duckdb.connect(":memory:")
        cur = DeadlineCursor(con.cursor())
        started = time.monotonic()
        with _interrupt_after(cur), query_clock(cur, 0.2):
            cur.execute("SELECT 1").fetchone()
            time.sleep(0.6)
            with pytest.raises(duckdb.InterruptException):
                cur.execute(FOREVER).fetchone()
        assert time.monotonic() - started < 5

    def test_a_query_after_the_clock_ends_is_not_refused(self) -> None:
        con = duckdb.connect(":memory:")
        cur = DeadlineCursor(con.cursor())
        for _ in range(20):
            with query_clock(cur, 0.001):
                time.sleep(0.003)
            assert cur.execute("SELECT 1").fetchone() == (1,)
            time.sleep(0.02)
            assert cur.execute("SELECT 2").fetchone() == (2,)

    def test_a_query_that_ends_in_time_does_not_disturb_the_next_query(self) -> None:
        con = duckdb.connect(":memory:")
        cur = DeadlineCursor(con.cursor())
        with query_clock(cur, 0.1):
            assert cur.execute("SELECT 1").fetchone() == (1,)
        time.sleep(0.3)
        assert cur.execute("SELECT 2").fetchone() == (2,)

    def test_the_interrupt_of_one_cursor_leaves_another_cursor_running(self) -> None:
        con = duckdb.connect(":memory:")
        slow, other = DeadlineCursor(con.cursor()), con.cursor()
        results: list[Any] = []

        def run_other() -> None:
            results.append(other.execute("SELECT count(*) FROM range(30000000) a, range(10) b").fetchone())

        thread = threading.Thread(target=run_other)
        thread.start()
        started = time.monotonic()
        with _interrupt_after(slow), query_clock(slow, 0.2), pytest.raises(duckdb.InterruptException):
            slow.execute(FOREVER).fetchone()
        assert time.monotonic() - started < 5
        thread.join(30)
        assert results == [(300000000,)]


def _client(store_path: Path, **limits: Any) -> TestClient:
    return TestClient(create_app(store_path, Limits(**limits)), raise_server_exceptions=False)


def _store(client: TestClient) -> Store:
    store: Store = client.app.state.store  # type: ignore[attr-defined]
    return store


class TestRequestLimits:
    @pytest.mark.parametrize(
        ("path", "params"),
        [
            ("/api/crosstab", {"row": "disease", "col": "tissue"}),
            ("/api/distribution", {"field": "disease"}),
            ("/api/entries/biosample", {}),
            ("/api/projects", {}),
            ("/api/terms", {"query": "cancer"}),
        ],
    )
    def test_a_request_that_runs_several_queries_past_the_time_limit_is_a_503(
        self, store_path: Path, path: str, params: dict[str, str]
    ) -> None:
        # With a limit of a nanosecond, the deadline has passed before the second query of the request starts.
        with _client(store_path, query_timeout=1e-9) as client:
            response = client.get(path, params=params)
            assert response.status_code == 503
            assert response.json()["type"] == PROBLEM_PREFIX + "query-timeout"
            assert response.headers["content-type"].startswith("application/problem+json")
            assert "retry-after" not in response.headers
            assert client.get("/api/dataset").status_code == 200

    def test_a_slow_query_does_not_stop_a_request_in_the_same_worker(self, store_path: Path) -> None:
        with _client(store_path, query_timeout=2, max_queries=4) as client:
            store = _store(client)
            started = threading.Event()
            outcome: list[str] = []

            def slow() -> None:
                with store.cursor(heavy=True) as cur:
                    started.set()
                    try:
                        with _interrupt_after(cur):
                            cur.execute(FOREVER).fetchone()
                    except duckdb.InterruptException:
                        outcome.append("interrupted")

            thread = threading.Thread(target=slow)
            thread.start()
            assert started.wait(5)
            begin = time.monotonic()
            assert client.get("/api/dataset").status_code == 200
            assert client.get("/api/projects").status_code == 200
            assert time.monotonic() - begin < 1.5
            thread.join(10)
            assert not thread.is_alive()
            assert outcome == ["interrupted"]

    @pytest.mark.parametrize(
        ("path", "params"),
        [
            ("/api/entries/biosample", {}),
            ("/api/distribution", {"field": "disease"}),
            ("/api/crosstab", {"row": "disease", "col": "tissue"}),
            ("/api/trend", {"field": "organism_id"}),
            ("/api/projects", {}),
            ("/api/terms", {"query": "cancer"}),
            ("/api/terms/children", {"field": "disease", "termId": "MONDO:0000001"}),
        ],
    )
    def test_every_store_reading_request_without_a_slot_is_a_503_with_retry_after(
        self, store_path: Path, path: str, params: dict[str, str]
    ) -> None:
        with _client(store_path, max_queries=1, queue_timeout=0) as client, _store(client).cursor(heavy=True):
            busy = client.get(path, params=params)
            assert busy.status_code == 503
            assert busy.json()["type"] == PROBLEM_PREFIX + "server-busy"
            assert int(busy.headers["retry-after"]) > 0
            assert client.get("/api/service-info").status_code == 200
            assert client.get("/api/dataset").status_code == 200
        with _client(store_path, max_queries=1, queue_timeout=0) as client:
            assert client.get("/api/projects").status_code == 200

    def test_the_wait_for_a_slot_does_not_count_toward_the_query_time(self, store_path: Path) -> None:
        with _client(store_path, max_queries=1, queue_timeout=10, query_timeout=1) as client:
            store = _store(client)
            holding = threading.Event()

            def hold() -> None:
                with store.cursor(heavy=True):
                    holding.set()
                    time.sleep(1.5)

            thread = threading.Thread(target=hold)
            thread.start()
            assert holding.wait(5)
            begin = time.monotonic()
            assert client.get("/api/projects").status_code == 200
            assert time.monotonic() - begin >= 1
            thread.join(10)

    def test_a_request_waits_for_a_slot_within_the_queue_time(self, store_path: Path) -> None:
        with _client(store_path, max_queries=1, queue_timeout=10) as client:
            store = _store(client)
            holding = threading.Event()

            def hold() -> None:
                with store.cursor(heavy=True):
                    holding.set()
                    time.sleep(0.5)

            thread = threading.Thread(target=hold)
            thread.start()
            assert holding.wait(5)
            begin = time.monotonic()
            assert client.get("/api/projects").status_code == 200
            assert time.monotonic() - begin >= 0.3
            thread.join(10)

    @pytest.mark.parametrize("path", ["/api/export/entries/biosample", "/api/export/accessions/biosample"])
    def test_an_export_time_limit_counts_each_page_and_not_the_client_read_time(
        self, store_path: Path, path: str
    ) -> None:
        with _client(store_path, query_timeout=0.5, export_batch=1) as client:
            total = client.get("/api/entries/biosample").json()["pagination"]["total"]
            begin = time.monotonic()
            messages = asyncio.run(call_asgi(client.app, path))
            assert time.monotonic() - begin > 0.5
        assert messages[0]["status"] == 200
        assert messages[-1] == {"type": "http.response.body", "body": b"", "more_body": False}
        body = b"".join(m.get("body", b"") for m in messages[1:])
        assert len(body.decode().splitlines()) == total + 1

    def test_an_export_past_the_time_limit_before_its_first_byte_is_a_503_and_gives_its_slot_back(
        self, store_path: Path
    ) -> None:
        with _client(store_path, query_timeout=1e-9, max_exports=1, queue_timeout=0) as client:
            response = client.get("/api/export/entries/biosample", params={"format": "ndjson"})
            assert response.status_code == 503
            assert response.json()["type"] == PROBLEM_PREFIX + "query-timeout"
            _store(client).open_export().close()

    def test_exports_in_a_row_each_get_the_only_export_slot(self, store_path: Path) -> None:
        with _client(store_path, max_exports=1, queue_timeout=0) as client:
            for path in (
                "/api/export/accessions/biosample",
                "/api/export/entries/biosample",
                "/api/export/accessions/bioproject",
                "/api/export/entries/biosample?format=ndjson",
            ):
                assert client.get(path).status_code == 200, path

    def test_a_request_for_an_export_without_a_slot_is_a_503(self, store_path: Path) -> None:
        with _client(store_path, max_exports=1, queue_timeout=0) as client:
            session = _store(client).open_export()
            try:
                for path in ("/api/export/accessions/biosample", "/api/export/entries/biosample"):
                    response = client.get(path)
                    assert response.status_code == 503, path
                    assert response.json()["type"] == PROBLEM_PREFIX + "server-busy"
            finally:
                session.close()
            assert client.get("/api/export/accessions/biosample").status_code == 200

    @pytest.mark.parametrize(
        ("path", "query"),
        [("/api/export/entries/biosample", b"format=ndjson"), ("/api/export/accessions/biosample", b"")],
    )
    def test_an_export_gives_its_slot_back_when_the_client_disconnects(
        self, store_path: Path, path: str, query: bytes
    ) -> None:
        # A cycle of references can keep a body alive until the garbage collector runs, so the collector is off.
        gc.disable()
        try:
            with _client(store_path, max_exports=1, queue_timeout=0, export_batch=1) as client:
                store = _store(client)
                messages = asyncio.run(call_asgi(client.app, path, query, disconnect_after=3))
                assert messages[0]["status"] == 200
                assert len(messages) < 100
                store.open_export().close()
        finally:
            gc.enable()

    def test_an_export_gives_its_slot_back_when_the_client_disconnects_before_the_response_starts(
        self, store_path: Path
    ) -> None:
        gc.disable()
        try:
            with _client(store_path, max_exports=1, queue_timeout=0, export_batch=1) as client:
                asyncio.run(call_asgi(client.app, "/api/export/entries/biosample", b"", disconnect_after=0))
                _store(client).open_export().close()
        finally:
            gc.enable()

    def test_an_export_that_fails_after_it_started_ends_incomplete_and_gives_its_slot_back(
        self, store_path: Path
    ) -> None:
        with _client(store_path, max_exports=1, queue_timeout=0, export_batch=1) as client:
            store = _store(client)
            messages: list[dict[str, Any]] = []

            def close_store_after_the_first_chunk(message: dict[str, Any]) -> None:
                messages.append(message)
                if len(messages) == 3:
                    store.close()

            with pytest.raises(Exception):  # noqa: B017, PT011
                asyncio.run(
                    call_asgi(
                        client.app,
                        "/api/export/entries/biosample",
                        b"format=ndjson",
                        on_send=close_store_after_the_first_chunk,
                    )
                )
            assert messages[0]["status"] == 200
            assert not any(m["type"] == "http.response.body" and not m.get("more_body") for m in messages)
            # The slot is free. The next export fails because the store is closed, and not because it must wait.
            with pytest.raises(duckdb.ConnectionException):
                store.open_export()

    @pytest.mark.parametrize("path", ["/api/export/accessions/biosample", "/api/export/entries/biosample"])
    def test_an_export_from_a_store_that_cannot_be_read_is_a_500_problem(self, store_path: Path, path: str) -> None:
        with _client(store_path) as client:
            _store(client).close()
            response = client.get(path)
            assert response.status_code == 500
            assert response.headers["content-type"].startswith("application/problem+json")

    def test_a_dropped_export_body_gives_its_slot_back(self, configured: Store) -> None:
        # The fixture keeps the default of two exports.
        first, second = configured.open_export(), configured.open_export()
        with pytest.raises(ApiError):
            configured.open_export()
        stream = _Stream(first, iter([b"a"]))
        assert next(stream) == b"a"
        del stream
        again = configured.open_export()
        again.close()
        again.close()
        second.close()
        first.close()
        configured.open_export().close()


class TestCors:
    def test_a_browser_of_another_origin_can_read_the_retry_and_request_headers(self, client: TestClient) -> None:
        response = client.get("/api/dataset", headers={"Origin": "https://example.org"})
        exposed = {h.strip().lower() for h in response.headers["access-control-expose-headers"].split(",")}
        assert {"retry-after", "x-request-id"} <= exposed


class TestLengths:
    def test_a_search_text_at_the_length_limit_is_accepted_and_a_longer_one_is_rejected(
        self, client: TestClient
    ) -> None:
        assert client.get("/api/terms", params={"query": "a" * 4096}).status_code == 200
        response = client.get("/api/terms", params={"query": "a" * 4097})
        assert response.status_code == 422
        assert response.json()["type"] == "about:blank"

    def test_a_term_id_or_a_field_name_at_the_length_limit_is_accepted_and_a_longer_one_is_rejected(
        self, client: TestClient
    ) -> None:
        assert client.get("/api/terms/children", params={"field": "disease", "termId": "T" * 256}).status_code == 404
        for params in ({"field": "disease", "termId": "T" * 257}, {"field": "d" * 257, "termId": "x"}):
            assert client.get("/api/terms/children", params=params).status_code == 422
        assert client.get("/api/terms/" + "T" * 256).status_code == 404
        assert client.get("/api/terms/" + "T" * 257).status_code == 422
        assert client.get("/api/distribution", params={"field": "d" * 257}).status_code == 422
        assert client.get("/api/crosstab", params={"row": "disease", "col": "d" * 257}).status_code == 422

    def test_an_accession_at_the_length_limit_is_accepted_and_a_longer_one_is_rejected(
        self, client: TestClient
    ) -> None:
        assert client.get("/api/entries/biosample/" + "S" * 64).status_code == 404
        assert client.get("/api/entries/biosample/" + "S" * 65).status_code == 422

    def test_an_element_at_the_length_limit_is_accepted_and_a_longer_one_is_an_invalid_element(
        self, client: TestClient
    ) -> None:
        ok = client.get("/api/distribution", params={"field": "disease", "elements": "MONDO:" + "T" * 250})
        assert ok.status_code == 200
        too_long = client.get("/api/distribution", params={"field": "disease", "elements": "T" * 257})
        assert too_long.status_code == 400
        assert too_long.json()["type"] == PROBLEM_PREFIX + "invalid-element"
        for path, params in (
            ("/api/crosstab", {"row": "disease", "col": "tissue", "rowElements": "T" * 257}),
            ("/api/trend", {"field": "disease", "elements": "T" * 257}),
        ):
            assert client.get(path, params=params).json()["type"] == PROBLEM_PREFIX + "invalid-element"

    @pytest.mark.parametrize("ch", ["a", "\u00e9"])
    @pytest.mark.parametrize(
        ("path", "params"),
        [
            ("/api/entries/biosample", {}),
            ("/api/distribution", {"field": "disease"}),
            ("/api/crosstab", {"row": "disease", "col": "tissue"}),
            ("/api/trend", {"field": "organism_id"}),
            ("/api/projects", {}),
            ("/api/terms", {"query": "cancer"}),
            ("/api/terms/children", {"field": "disease", "termId": "MONDO:0000001"}),
            ("/api/export/entries/biosample", {}),
            ("/api/export/accessions/biosample", {}),
            ("/api/dsl/parse", {}),
        ],
    )
    def test_a_q_over_the_limit_is_an_unexpected_token_for_every_operation_that_takes_q(
        self, client: TestClient, path: str, params: dict[str, str], ch: str
    ) -> None:
        head, tail = 'disease:"MONDO:', '"'
        fits = head + ch * (4096 - len(head) - len(tail)) + tail
        assert len(fits) == 4096
        assert client.get(path, params={**params, "q": fits}).status_code == 200
        response = client.get(path, params={**params, "q": fits + ch})
        assert response.status_code == 400
        assert response.json()["type"] == PROBLEM_PREFIX + "unexpected-token"

    def test_a_condition_in_a_body_has_at_most_the_characters_of_a_condition(self, client: TestClient) -> None:
        for path, body in (
            ("/api/dsl/select", {"q": "a" * 4097, "clauses": [{"field": "disease", "value": "x"}]}),
            ("/api/dsl/keyword", {"q": "a" * 4097, "keyword": "x"}),
        ):
            assert client.post(path, json=body).status_code == 422, path

    def test_a_clause_has_at_most_the_characters_of_a_condition_in_its_value(self, client: TestClient) -> None:
        clause = {"field": "disease", "value": "x" * 4097}
        assert client.post("/api/dsl/select", json={"clauses": [clause]}).status_code == 422
        # The longest value that the schema accepts reaches the parser, which refuses it as a condition.
        longest = {"field": "disease", "value": "MONDO:" + "x" * 4090}
        response = client.post("/api/dsl/select", json={"clauses": [longest]})
        assert response.status_code == 400
        assert response.json()["type"] == PROBLEM_PREFIX + "unexpected-token"
        assert client.post("/api/dsl/select", json={"clauses": [{"field": "d" * 257, "value": "x"}]}).status_code == 422
        too_long = {"field": "date_published", "from": "2020-01-01", "to": "2" * 4097}
        assert client.post("/api/dsl/select", json={"clauses": [too_long]}).status_code == 422
        longest_date = {"field": "date_published", "from": "2020-01-01", "to": "2" * 4096}
        response = client.post("/api/dsl/select", json={"clauses": [longest_date]})
        assert response.status_code == 400
        assert response.json()["type"] == PROBLEM_PREFIX + "invalid-date-format"

    def test_a_select_has_at_most_as_many_clauses_as_a_condition_has_nodes(self, client: TestClient) -> None:
        clauses = [
            {"field": "date_published", "from": f"{1000 + i}-01-01", "to": f"{1000 + i}-12-31"} for i in range(513)
        ]
        # 512 date range clauses are within the clause limit, but they make a condition that is too long.
        assert client.post("/api/dsl/select", json={"clauses": clauses[:512]}).status_code == 400
        response = client.post("/api/dsl/select", json={"clauses": clauses})
        assert response.status_code == 422
        assert response.json()["type"] == "about:blank"

    def test_a_removal_of_many_date_ranges_is_accepted(self, client: TestClient) -> None:
        # Selecting clauses that are all in the condition removes them. The request removes all 90 date ranges.
        ranges = [f"date_published:[{1000 + i}-01-01 TO {1000 + i}-12-31]" for i in range(90)]
        q = " OR ".join(ranges)
        clauses = [
            {"field": "date_published", "from": f"{1000 + i}-01-01", "to": f"{1000 + i}-12-31"} for i in range(90)
        ]
        response = client.post("/api/dsl/select", json={"q": q, "clauses": clauses})
        assert response.status_code == 200
        assert response.json()["dsl"] is None

    def test_the_limits_are_in_the_openapi_document(self, client: TestClient) -> None:
        spec = client.get("/api/openapi.json").json()
        schemas = spec["components"]["schemas"]
        assert schemas["SelectRequest"]["properties"]["clauses"]["maxItems"] == 512
        assert schemas["KeywordRequest"]["properties"]["keyword"]["maxLength"] == 4096
        parameters = {p["name"]: p for p in spec["paths"]["/api/terms"]["get"]["parameters"]}
        assert parameters["query"]["schema"]["maxLength"] == 4096


class TestElementLimit:
    @pytest.mark.parametrize(
        ("path", "params", "dimension"),
        [
            ("/api/distribution", {"field": "disease"}, "elements"),
            ("/api/crosstab", {"row": "disease", "col": "tissue"}, "rowElements"),
            ("/api/crosstab", {"row": "disease", "col": "tissue"}, "colElements"),
            ("/api/trend", {"field": "disease"}, "elements"),
        ],
    )
    def test_a_request_names_at_most_100_elements_of_a_dimension(
        self, client: TestClient, path: str, params: dict[str, str], dimension: str
    ) -> None:
        names = ",".join(f"MONDO:{i}" for i in range(100))
        assert client.get(path, params={**params, dimension: names}).status_code == 200
        response = client.get(path, params={**params, dimension: names + ",MONDO:100"})
        assert response.status_code == 400
        assert response.json()["type"] == PROBLEM_PREFIX + "too-many-elements"

    @pytest.mark.parametrize(
        ("path", "params", "maximum"),
        [
            ("/api/crosstab", {"row": "disease", "col": "tissue"}, 100),
            ("/api/distribution", {"field": "disease"}, 200),
            ("/api/terms", {"query": "cancer"}, 100),
            ("/api/trend", {"field": "disease"}, 200),
        ],
    )
    def test_the_limit_of_each_operation_accepts_1_to_its_maximum_and_rejects_0_and_one_more(
        self, client: TestClient, path: str, params: dict[str, str], maximum: int
    ) -> None:
        for accepted in (1, maximum):
            assert client.get(path, params={**params, "limit": accepted}).status_code == 200, accepted
        for rejected in (0, maximum + 1):
            assert client.get(path, params={**params, "limit": rejected}).status_code == 422, rejected


class TestStaleTemporaryDirectories:
    def test_a_directory_of_a_worker_that_is_gone_is_removed_at_start(
        self, copy_of_store: Path, tmp_path: Path
    ) -> None:
        base = tmp_path / "temp"
        stale = base / "worker-999999"
        stale.mkdir(parents=True)
        (stale / "duckdb_temp_storage-0.tmp").write_bytes(b"x" * 100)
        alive = base / "worker-1"
        alive.mkdir()
        other = base / "notes"
        other.mkdir()
        store = Store(copy_of_store, Limits(temp_directory=base))
        try:
            assert not stale.exists()
            assert alive.exists()
            assert other.exists()
        finally:
            store.close()
