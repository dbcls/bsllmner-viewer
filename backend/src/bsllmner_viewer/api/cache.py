"""Validation and an in-process cache of the GET responses of the api.

The store does not change while the api serves it, and neither the code nor the installed packages change while a
worker runs, so a GET request has the same response for as long as a worker runs. The `ETag` of a response is a digest
of the code, the packages, the store version, and the request, so the middleware knows it before the request runs: a
request whose `If-None-Match` names it gets status 304 without reading the store, and a repeated request gets the
response that the worker kept.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
from collections import OrderedDict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

PACKAGE_DIR = Path(__file__).resolve().parents[1]

# The exports stream and can be large, and the service information reports the state of the store, which can change.
UNCACHED_PREFIXES = ("/api/export/", "/api/service-info")
CACHE_CONTROL = "no-cache"
CACHE_BYTES = 64 * 1024 * 1024
# A larger response is not kept, so that one response cannot push out many.
MAX_KEPT_BYTES = 4 * 1024 * 1024
# An estimate of the memory that a kept response uses besides its key and its body: its headers, its record, and the
# entry of the cache.
KEPT_OVERHEAD = 1024
# `If-None-Match: *` asks for status 304 whenever the resource has a current response.
ANY_TAG = "*"


def installed_packages() -> list[tuple[str, str]]:
    """The name and the version of every installed distribution, in order."""
    return sorted((dist.name, dist.version) for dist in importlib.metadata.distributions())


def code_digest(root: Path = PACKAGE_DIR, packages: Iterable[tuple[str, str]] | None = None) -> str:
    """A digest of the files of the package and of the installed packages, which every worker computes alike.

    Every file counts, not only the Python files, because the package also reads data files, such as the grammar of
    the conditions. The installed packages count, because an update of a dependency, such as FastAPI, can change a
    response without a change of the code.
    """
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    for name, version in installed_packages() if packages is None else packages:
        digest.update(f"{name}=={version}\0".encode())
    return digest.hexdigest()


CODE_DIGEST = code_digest()


@dataclass(frozen=True, slots=True)
class _Kept:
    headers: list[tuple[bytes, bytes]]
    body: bytes
    size: int


class ResponseCache:
    """`ETag`, `Cache-Control`, status 304, and a cache of the latest responses, for the GET requests of the api.

    The cache holds up to `max_bytes` of keys and bodies, with `KEPT_OVERHEAD` for each response, and drops the least
    recently used response first. A key holds the query string, which can be long, so the keys count as well. The
    middleware runs on the event loop of the worker, so the cache needs no lock.
    """

    def __init__(self, app: ASGIApp, code: str | None = None, max_bytes: int = CACHE_BYTES) -> None:
        self.app = app
        self.code = CODE_DIGEST if code is None else code
        self.max_bytes = max_bytes
        self._kept: OrderedDict[str, _Kept] = OrderedDict()
        self._bytes = 0

    @property
    def kept_bytes(self) -> int:
        return self._bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "GET" or not _cacheable(scope["path"]):
            await self.app(scope, receive, send)
            return
        key = f"{scope['path']}?{scope['query_string'].decode('latin-1')}"
        tag = self._tag(scope, key)
        named = _named_tags(Headers(scope=scope).getlist("if-none-match"))
        kept = self._kept.get(key)
        if tag in named or (ANY_TAG in named and kept is not None):
            await _send_not_modified(send, tag)
            return
        if kept is not None:
            self._kept.move_to_end(key)
            await send({"type": "http.response.start", "status": 200, "headers": list(kept.headers)})
            await send({"type": "http.response.body", "body": kept.body})
            return
        await self.app(scope, receive, self._recording(send, key, tag, not_modified=ANY_TAG in named))

    def _tag(self, scope: Scope, key: str) -> str:
        store_digest: str = scope["app"].state.store.version_digest
        return '"' + hashlib.sha256(f"{self.code}\0{store_digest}\0{key}".encode()).hexdigest()[:32] + '"'

    def _recording(self, send: Send, key: str, tag: str, not_modified: bool) -> Send:
        """Send the response, and keep it when it has status 200. With `not_modified`, a response with status 200 is
        sent as status 304 without a body, and still kept."""
        headers: list[tuple[bytes, bytes]] | None = None
        chunks: list[bytes] = []
        size = 0

        async def send_and_keep(message: Message) -> None:
            nonlocal headers, size
            if message["type"] == "http.response.start" and message["status"] == 200:
                MutableHeaders(scope=message).update({"etag": tag, "cache-control": CACHE_CONTROL})
                headers = list(message["headers"])
                if not_modified:
                    await send({"type": "http.response.start", "status": 304, "headers": _validators(tag)})
                    return
            elif message["type"] == "http.response.body" and headers is not None:
                body: bytes = message.get("body", b"")
                more = message.get("more_body", False)
                size += len(body)
                if size <= MAX_KEPT_BYTES:
                    chunks.append(body)
                    if not more:
                        whole = b"".join(chunks)
                        self._keep(key, _Kept(headers, whole, len(key) + len(whole) + KEPT_OVERHEAD))
                else:
                    chunks.clear()
                if not_modified:
                    if not more:
                        await send({"type": "http.response.body", "body": b""})
                    return
            await send(message)

        return send_and_keep

    def _keep(self, key: str, kept: _Kept) -> None:
        if key in self._kept:
            self._bytes -= self._kept.pop(key).size
        self._kept[key] = kept
        self._bytes += kept.size
        while self._bytes > self.max_bytes and self._kept:
            _, dropped = self._kept.popitem(last=False)
            self._bytes -= dropped.size


def _cacheable(path: str) -> bool:
    return path.startswith("/api") and not path.startswith(UNCACHED_PREFIXES)


def _validators(tag: str) -> list[tuple[bytes, bytes]]:
    return [(b"etag", tag.encode()), (b"cache-control", CACHE_CONTROL.encode())]


async def _send_not_modified(send: Send, tag: str) -> None:
    await send({"type": "http.response.start", "status": 304, "headers": _validators(tag)})
    await send({"type": "http.response.body", "body": b""})


def _named_tags(values: list[str]) -> set[str]:
    """The tags that the `If-None-Match` header lines list, without the weak marker (`W/`).

    A proxy that compresses the body adds the weak marker to a tag.
    """
    return {tag.strip().removeprefix("W/") for value in values for tag in value.split(",") if tag.strip()}
