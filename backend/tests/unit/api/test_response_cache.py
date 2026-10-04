"""Validators and the cache of GET responses.

A response stays the same while a worker serves one store with one code.
"""

from __future__ import annotations

import shutil
from collections import OrderedDict
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import duckdb
import pytest
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse
from starlette.routing import Route

from bsllmner_viewer.api import cache
from bsllmner_viewer.api.app import create_app
from bsllmner_viewer.api.cache import ResponseCache, code_digest
from bsllmner_viewer.api.limits import Limits
from bsllmner_viewer.api.store import Store
from bsllmner_viewer.store.version import write_meta

DISEASE = 'disease:"MONDO:0007254"'

# GET requests whose response depends only on the store, the code, and the request.
CACHED = [
    ("/api/dataset", {}),
    ("/api/dsl/parse", {"q": DISEASE}),
    ("/api/entries/biosample", {"q": DISEASE}),
    ("/api/distribution", {"field": "disease", "q": DISEASE}),
    ("/api/crosstab", {"row": "disease", "col": "library_strategy"}),
    ("/api/trend", {"field": "disease"}),
    ("/api/projects", {"q": DISEASE}),
    ("/api/terms", {"query": "breast"}),
    ("/api/terms/children", {"field": "disease", "termId": "MONDO:0004992"}),
    ("/api/openapi.json", {}),
]

EXPORTS = ["/api/service-info", "/api/export/accessions/biosample", "/api/export/entries/biosample"]


@contextmanager
def _client(store_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(store_path), raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def fresh(store_path: Path) -> Iterator[TestClient]:
    """A client of a new app, whose cache is empty."""
    with _client(store_path) as client:
        yield client


def _close_store(client: TestClient) -> None:
    """Close the store of the app, so that a request that reads the store fails with status 500."""
    store: Store = client.app.state.store  # type: ignore[attr-defined]
    store.close()


def _exposed(response: object) -> set[str]:
    headers = response.headers  # type: ignore[attr-defined]
    return {name.strip().lower() for name in headers["access-control-expose-headers"].split(",")}


class TestValidators:
    @pytest.mark.parametrize(("path", "params"), CACHED)
    def test_a_get_response_with_status_200_has_an_etag_and_no_cache(
        self, fresh: TestClient, path: str, params: dict[str, str]
    ) -> None:
        response = fresh.get(path, params=params)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["etag"].startswith('"')
        assert response.headers["etag"].endswith('"')

    @pytest.mark.parametrize("path", EXPORTS)
    def test_the_exports_and_the_service_information_have_no_validators(self, fresh: TestClient, path: str) -> None:
        response = fresh.get(path)
        assert response.status_code == 200
        assert "etag" not in response.headers
        assert "cache-control" not in response.headers

    @pytest.mark.parametrize(
        ("path", "params"),
        [("/api/entries/biosample", {"q": "nope:x"}), ("/api/entries/biosample/NOPE1", {}), ("/api/nope", {})],
    )
    def test_an_error_has_no_validators(self, fresh: TestClient, path: str, params: dict[str, str]) -> None:
        response = fresh.get(path, params=params)
        assert response.status_code >= 400
        assert "etag" not in response.headers
        assert "cache-control" not in response.headers

    def test_a_post_has_no_validators(self, fresh: TestClient) -> None:
        response = fresh.post("/api/dsl/select", json={"q": None, "clauses": [{"field": "disease", "value": "X:1"}]})
        assert response.status_code == 200
        assert "etag" not in response.headers

    def test_the_same_request_has_the_same_etag_and_another_request_another(self, fresh: TestClient) -> None:
        first = fresh.get("/api/distribution", params={"field": "disease"}).headers["etag"]
        again = fresh.get("/api/distribution", params={"field": "disease"}).headers["etag"]
        other = fresh.get("/api/distribution", params={"field": "tissue"}).headers["etag"]
        reordered = fresh.get("/api/distribution?unit=biosample&field=disease").headers["etag"]
        assert first == again
        assert len({first, other, reordered}) == 3

    def test_every_worker_of_the_same_store_and_code_gives_the_same_etag(self, store_path: Path) -> None:
        with _client(store_path) as one, _client(store_path) as two:
            assert one.get("/api/dataset").headers["etag"] == two.get("/api/dataset").headers["etag"]

    def test_a_script_of_another_origin_can_read_the_etag_to_send_it_back(self, fresh: TestClient) -> None:
        response = fresh.get("/api/dataset", headers={"Origin": "https://example.org"})
        assert response.headers["etag"]
        assert "etag" in _exposed(response)


class TestNotModified:
    @pytest.mark.parametrize("form", ["{tag}", "W/{tag}", '"other", {tag}', 'W/"other" , W/{tag}'])
    def test_a_request_that_names_the_etag_gets_304_without_a_body(self, fresh: TestClient, form: str) -> None:
        tag = fresh.get("/api/trend", params={"field": "disease"}).headers["etag"]
        response = fresh.get("/api/trend", params={"field": "disease"}, headers={"If-None-Match": form.format(tag=tag)})
        assert response.status_code == 304
        assert response.content == b""
        assert response.headers["etag"] == tag
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-request-id"]

    def test_the_etag_on_a_later_line_of_the_header_counts(self, fresh: TestClient) -> None:
        tag = fresh.get("/api/trend", params={"field": "disease"}).headers["etag"]
        response = fresh.get(
            "/api/trend", params={"field": "disease"}, headers=[("If-None-Match", '"other"'), ("If-None-Match", tag)]
        )
        assert response.status_code == 304

    @pytest.mark.parametrize("value", ['"other"', "", "W/", '"'])
    def test_a_request_that_names_another_etag_gets_the_response(self, fresh: TestClient, value: str) -> None:
        expected = fresh.get("/api/trend", params={"field": "disease"})
        response = fresh.get("/api/trend", params={"field": "disease"}, headers={"If-None-Match": value})
        assert response.status_code == 200
        assert response.content == expected.content

    def test_any_etag_gets_304_for_a_kept_response(self, fresh: TestClient) -> None:
        tag = fresh.get("/api/projects").headers["etag"]
        response = fresh.get("/api/projects", headers={"If-None-Match": "*"})
        assert response.status_code == 304
        assert response.headers["etag"] == tag

    def test_any_etag_gets_304_for_a_response_that_is_not_kept_yet_and_keeps_it(self, fresh: TestClient) -> None:
        response = fresh.get("/api/projects", headers={"If-None-Match": "*"})
        assert response.status_code == 304
        assert response.content == b""
        _close_store(fresh)
        kept = fresh.get("/api/projects")
        assert kept.status_code == 200
        assert kept.headers["etag"] == response.headers["etag"]
        assert kept.json()["items"]

    def test_any_etag_does_not_hide_an_error(self, fresh: TestClient) -> None:
        assert fresh.get("/api/entries/biosample/NOPE1", headers={"If-None-Match": "*"}).status_code == 404

    def test_a_304_does_not_read_the_store(self, fresh: TestClient, store_path: Path) -> None:
        tag = fresh.get("/api/crosstab", params={"row": "disease", "col": "tissue"}).headers["etag"]
        with _client(store_path) as other:
            _close_store(other)
            assert other.get("/api/crosstab", params={"row": "disease", "col": "tissue"}).status_code == 500
            response = other.get(
                "/api/crosstab", params={"row": "disease", "col": "tissue"}, headers={"If-None-Match": tag}
            )
            assert response.status_code == 304

    @pytest.mark.parametrize(("path", "params"), [("/api/dataset", {}), ("/api/distribution", {"field": "disease"})])
    def test_the_etag_of_another_store_gets_the_response_of_this_store(
        self, store_path: Path, tmp_path: Path, path: str, params: dict[str, str]
    ) -> None:
        rebuilt = tmp_path / "rebuilt.duckdb"
        shutil.copy(store_path, rebuilt)
        con = duckdb.connect(str(rebuilt))
        write_meta(con, "created_at", "2100-01-01T00:00:00Z")
        con.close()
        with _client(store_path) as before:
            tag = before.get(path, params=params).headers["etag"]
        with _client(rebuilt) as after:
            response = after.get(path, params=params, headers={"If-None-Match": tag})
            assert response.status_code == 200
            assert response.headers["etag"] != tag


class TestBusyStore:
    def test_a_304_is_answered_while_every_slot_is_busy(self, store_path: Path) -> None:
        limits = Limits(max_queries=1, queue_timeout=0)
        with TestClient(create_app(store_path, limits), raise_server_exceptions=False) as client:
            tag = client.get("/api/projects").headers["etag"]
            store: Store = client.app.state.store  # type: ignore[attr-defined]
            with store.cursor(heavy=True):
                kept = client.get("/api/projects", headers={"If-None-Match": tag})
                other = client.get("/api/distribution", params={"field": "disease"}, headers={"If-None-Match": tag})
            assert kept.status_code == 304
            assert other.status_code == 503
            assert other.json()["type"].endswith("server-busy")


def _tiny_app(
    code: str, calls: list[str], sizes: dict[str, int] | None = None, max_bytes: int = cache.CACHE_BYTES
) -> Starlette:
    """An app whose GET /api/<name> answers `sizes[name]` bytes (10 by default), and records each call."""

    async def endpoint(request: Request) -> Response:
        name = request.path_params["name"]
        calls.append(name)
        return Response(b"x" * (sizes or {}).get(name, 10), media_type="text/plain")

    async def chunked(request: Request) -> Response:
        calls.append("chunked")

        async def body() -> AsyncIterator[bytes]:
            yield b"first-"
            yield b"second"

        return StreamingResponse(body(), media_type="text/plain")

    app = Starlette(routes=[Route("/api/chunked", chunked), Route("/api/{name}", endpoint)])
    app.state.store = SimpleNamespace(version_digest="v")
    app.add_middleware(ResponseCache, code=code, max_bytes=max_bytes)
    return app


class TestCode:
    def test_the_etag_of_another_code_gets_the_response_of_this_code(self) -> None:
        calls: list[str] = []
        with TestClient(_tiny_app("before", calls)) as before:
            tag = before.get("/api/a").headers["etag"]
        with TestClient(_tiny_app("after", calls)) as after:
            response = after.get("/api/a", headers={"If-None-Match": tag})
            assert response.status_code == 200
            assert response.headers["etag"] != tag
        assert calls == ["a", "a"]

    def test_the_same_files_and_packages_give_the_same_digest(self, tmp_path: Path) -> None:
        (tmp_path / "pkg").mkdir()
        (tmp_path / "pkg" / "a.py").write_text("A = 1\n")
        (tmp_path / "grammar.lark").write_text("start: WORD\n")
        packages = [("duckdb", "1.5.5"), ("fastapi", "0.1")]
        assert code_digest(tmp_path, packages) == code_digest(tmp_path, list(packages))

    @pytest.mark.parametrize(
        "change",
        ["edit a module", "edit a data file", "move a module", "add a file", "update a package", "add a package"],
    )
    def test_a_change_of_a_file_or_of_an_installed_package_gives_another_digest(
        self, tmp_path: Path, change: str
    ) -> None:
        (tmp_path / "pkg").mkdir()
        (tmp_path / "pkg" / "a.py").write_text("A = 1\n")
        (tmp_path / "grammar.lark").write_text("start: WORD\n")
        packages = [("duckdb", "1.5.5"), ("fastapi", "0.1")]
        first = code_digest(tmp_path, packages)
        if change == "edit a module":
            (tmp_path / "pkg" / "a.py").write_text("A = 2\n")
        elif change == "edit a data file":
            (tmp_path / "grammar.lark").write_text("start: WORD+\n")
        elif change == "move a module":
            (tmp_path / "pkg" / "a.py").rename(tmp_path / "pkg" / "b.py")
        elif change == "add a file":
            (tmp_path / "pkg" / "data.json").write_text("{}")
        elif change == "update a package":
            packages = [("duckdb", "1.5.6"), ("fastapi", "0.1")]
        else:
            packages = [*packages, ("lark", "1.2")]
        assert code_digest(tmp_path, packages) != first

    def test_compiled_files_do_not_change_the_digest(self, tmp_path: Path) -> None:
        (tmp_path / "a.py").write_text("A = 1\n")
        first = code_digest(tmp_path, [])
        (tmp_path / "__pycache__").mkdir()
        (tmp_path / "__pycache__" / "a.cpython-312.pyc").write_bytes(b"\0")
        assert code_digest(tmp_path, []) == first

    def test_the_digest_of_the_api_names_the_installed_packages(self, tmp_path: Path) -> None:
        names = {name.lower() for name, _ in cache.installed_packages()}
        assert {"duckdb", "fastapi", "pydantic"} <= names
        assert cache.code_digest(tmp_path) == cache.code_digest(tmp_path, cache.installed_packages())
        assert cache.code_digest(tmp_path) != cache.code_digest(tmp_path, [])


class TestKeptResponses:
    @pytest.mark.parametrize(("path", "params"), CACHED)
    def test_a_repeated_request_gets_the_same_response_without_reading_the_store(
        self, fresh: TestClient, path: str, params: dict[str, str]
    ) -> None:
        first = fresh.get(path, params=params, headers={"X-Request-ID": "first"})
        _close_store(fresh)
        again = fresh.get(path, params=params, headers={"X-Request-ID": "again"})
        assert again.status_code == 200
        assert again.content == first.content
        assert again.headers["content-type"] == first.headers["content-type"]
        assert again.headers["etag"] == first.headers["etag"]
        assert again.headers["x-request-id"] == "again"

    def test_a_kept_response_to_another_origin_has_the_cors_headers(self, fresh: TestClient) -> None:
        fresh.get("/api/dataset")
        again = fresh.get("/api/dataset", headers={"Origin": "https://example.org"})
        assert again.headers["access-control-allow-origin"] == "*"
        assert "etag" in _exposed(again)

    def test_an_error_is_not_kept(self, fresh: TestClient) -> None:
        assert fresh.get("/api/entries/biosample/NOPE1").status_code == 404
        _close_store(fresh)
        assert fresh.get("/api/entries/biosample/NOPE1").status_code == 500

    def test_a_new_worker_starts_without_kept_responses(self, store_path: Path) -> None:
        with _client(store_path) as before:
            assert before.get("/api/projects").status_code == 200
        with _client(store_path) as after:
            _close_store(after)
            assert after.get("/api/projects").status_code == 500


class TestCacheSize:
    def test_the_default_size_of_the_response_cache_is_64_mib(self) -> None:
        app = _tiny_app("code", [])
        with TestClient(app):
            middleware = app.middleware_stack.app  # type: ignore[union-attr]
            assert isinstance(middleware, ResponseCache)
            assert middleware.max_bytes == 64 * 1024 * 1024

    def test_a_response_of_several_chunks_is_kept_whole(self) -> None:
        calls: list[str] = []
        with TestClient(_tiny_app("code", calls)) as client:
            first = client.get("/api/chunked")
            again = client.get("/api/chunked")
        assert first.content == b"first-second"
        assert again.content == first.content
        assert calls == ["chunked"]

    def test_a_response_over_the_maximum_kept_size_is_sent_but_not_kept(self) -> None:
        calls: list[str] = []
        sizes = {"big": cache.MAX_KEPT_BYTES + 1, "small": 10}
        with TestClient(_tiny_app("code", calls, sizes)) as client:
            for name in ["big", "big", "small", "small"]:
                response = client.get(f"/api/{name}")
                assert len(response.content) == sizes[name]
        assert calls == ["big", "big", "small"]

    def test_a_long_query_string_counts_toward_the_limit(self) -> None:
        calls: list[str] = []
        long = "q=" + "x" * 4000
        room = len(f"/api/a?{long}") + 10 + cache.KEPT_OVERHEAD
        with TestClient(_tiny_app("code", calls, max_bytes=room)) as client:
            for query in [long, long, long[:-1], long]:
                client.get(f"/api/a?{query}")
        assert len(calls) == 3

    @given(st.lists(st.sampled_from("abcdef"), max_size=40), st.integers(min_value=0, max_value=8000))
    def test_the_app_is_called_exactly_when_a_least_recently_used_cache_of_max_bytes_misses(
        self, names: list[str], max_bytes: int
    ) -> None:
        sizes = {name: 10 * (i + 1) for i, name in enumerate("abcdef")}
        calls: list[str] = []
        app = _tiny_app("code", calls, sizes, max_bytes=max_bytes)
        model: OrderedDict[str, int] = OrderedDict()
        misses: list[str] = []
        with TestClient(app) as client:
            for name in names:
                assert client.get(f"/api/{name}").content == b"x" * sizes[name]
                if name in model:
                    model.move_to_end(name)
                    continue
                misses.append(name)
                model[name] = len(f"/api/{name}?") + sizes[name] + cache.KEPT_OVERHEAD
                while sum(model.values()) > max_bytes:
                    model.popitem(last=False)
            middleware = app.middleware_stack.app  # type: ignore[union-attr]
            assert isinstance(middleware, ResponseCache)
            assert middleware.kept_bytes == sum(model.values()) <= max_bytes
        assert calls == misses
