"""Helpers that read the API through a test client, shared by the API tests."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator
from typing import Any

from fastapi.testclient import TestClient

from bsllmner_viewer.dsl.ast import Node, normalize
from bsllmner_viewer.dsl.serializer import serialize


def condition_q(ast: Node | None) -> str | None:
    """The normalized, serialized `q` of a condition."""
    return None if ast is None else serialize(normalize(ast))


def accessions(client: TestClient, unit: str, q: str | None = None) -> list[str]:
    """The accessions of the population, read from the export (the header line is dropped)."""
    response = client.get(f"/api/export/accessions/{unit}", params={"q": q} if q else {})
    assert response.status_code == 200, (unit, q, response.text)
    lines: list[str] = response.text.splitlines()
    return lines[1:]


def count(client: TestClient, q: str | None, unit: str = "biosample") -> int:
    """The number of items of `unit` in the population of `q`."""
    if unit == "biosample":
        params = {"q": q} if q else {}
        return int(client.get("/api/entries/biosample", params=params).json()["pagination"]["total"])
    return len(accessions(client, unit, q))


def entry_pages(client: TestClient, q: str | None = None, per_page: int = 100) -> Iterator[dict[str, Any]]:
    """The pages of `/api/entries/biosample` for `q`, from the first to the last."""
    page = 1
    while True:
        params: dict[str, Any] = {"perPage": per_page, "page": page}
        if q:
            params["q"] = q
        body: dict[str, Any] = client.get("/api/entries/biosample", params=params).json()
        yield body
        if not body["pagination"]["hasNext"]:
            return
        page += 1


def entry_items(client: TestClient, q: str | None = None) -> list[dict[str, Any]]:
    """Every item of `/api/entries/biosample` for `q`."""
    return [item for body in entry_pages(client, q) for item in body["items"]]


def select_clause(q: str | None, clause: dict[str, str]) -> str:
    """`q` narrowed by a clause object of an API response (a value or a range)."""
    field = clause["field"]
    piece = f"{field}:[{clause['from']} TO {clause['to']}]" if "from" in clause else f'{field}:"{clause["value"]}"'
    return piece if q is None else f"({q}) AND {piece}"


def and_clauses(q: str | None, clauses: list[dict[str, str]]) -> str | None:
    """`q` narrowed by every clause object, in order."""
    for clause in clauses:
        q = select_clause(q, clause)
    return q


async def call_asgi(
    app: Any,
    path: str,
    query: bytes = b"",
    *,
    disconnect_after: int | None = None,
    on_send: Callable[[dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """Call the ASGI app of a started test client and return the messages that it sent.

    The client is slow (every message takes 20 milliseconds), and it disconnects after `disconnect_after` messages
    when that is given, as a browser does when a download is cancelled.
    """
    messages: list[dict[str, Any]] = []
    disconnect = asyncio.Event()
    if disconnect_after == 0:
        disconnect.set()

    async def receive() -> dict[str, Any]:
        await disconnect.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)
        if on_send is not None:
            on_send(message)
        await asyncio.sleep(0.02)
        if disconnect_after is not None and len(messages) >= disconnect_after:
            disconnect.set()

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": query,
        "headers": [],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
        "state": {},
    }
    await app(scope, receive, send)
    return messages
