"""FastAPI application factory."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, MutableMapping
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from bsllmner_viewer.api.problems import REQUEST_ID_HEADER, ProblemDetails, install_problem_handlers
from bsllmner_viewer.api.routers import aggregations, dataset, dsl, entries, export, projects, service_info, terms
from bsllmner_viewer.api.store import Store, store_path_from_env

API_VERSION = "0.1.0"

OPENAPI_TAGS: list[dict[str, str]] = [
    {"name": "Entries", "description": "Lists of BioSamples and SRA experiments, and the detail of one BioSample."},
    {
        "name": "Aggregations",
        "description": "Counts of the matching BioSamples or experiments per element of one or two dimensions, "
        "and per year.",
    },
    {"name": "Condition", "description": "Conversion between condition strings and ASTs, and element selection."},
    {"name": "Projects", "description": "BioProjects of the matching BioSamples."},
    {"name": "Terms", "description": "Search and navigation of the ontology terms that annotate the BioSamples."},
    {"name": "Export", "description": "Matching entries and accessions as files."},
    {"name": "Dataset", "description": "Version information, fields, and population totals of the dataset."},
    {"name": "Service Info", "description": "Service metadata and the state of the store."},
]

_ERROR_STATUS_CODES = ("400", "404", "422", "500")
_PROBLEM_MEDIA_TYPE = "application/problem+json"
_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ProblemDetails, "description": "Bad Request"},
    422: {"model": ProblemDetails, "description": "Unprocessable Entity"},
    500: {"model": ProblemDetails, "description": "Internal Server Error"},
}


class RequestIdMiddleware:
    """Attach `X-Request-ID` to every response.

    The value of a non-empty request header is repeated. Otherwise the middleware generates a UUID.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = Headers(scope=scope).get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        state: MutableMapping[str, Any] = scope.setdefault("state", {})
        state["request_id"] = request_id

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        await self.app(scope, receive, send_with_request_id)


def _rewrite_error_content_types(operation: dict[str, Any]) -> None:
    for status_code, response in operation.get("responses", {}).items():
        content = response.get("content")
        if status_code not in _ERROR_STATUS_CODES or not content:
            continue
        for media_type in list(content):
            if media_type != _PROBLEM_MEDIA_TYPE:
                content[_PROBLEM_MEDIA_TYPE] = content.pop(media_type)


def create_app(store_path: Path | None = None) -> FastAPI:
    path = store_path or store_path_from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.store = Store(path)
        try:
            yield
        finally:
            app.state.store.close()

    app = FastAPI(
        title="bsllmner-viewer API",
        version=API_VERSION,
        description=(
            "Queries, aggregations, and exports over ontology-mapped BioSample annotations. "
            "The conventions follow the DDBJ Search API."
        ),
        lifespan=lifespan,
        docs_url="/api",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        redirect_slashes=False,
        openapi_tags=OPENAPI_TAGS,
        contact={"name": "BioData Science Initiative", "url": "https://github.com/dbcls/bsllmner-viewer"},
        license_info={"name": "Apache-2.0", "url": "https://www.apache.org/licenses/LICENSE-2.0"},
    )
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.add_middleware(RequestIdMiddleware)
    install_problem_handlers(app)
    for router in (
        dataset.router,
        dsl.router,
        entries.router,
        aggregations.router,
        projects.router,
        terms.router,
        export.router,
        service_info.router,
    ):
        app.include_router(router, prefix="/api", responses=_ERROR_RESPONSES)

    original_openapi = app.openapi

    def custom_openapi() -> dict[str, Any]:
        schema = original_openapi()
        schemas = schema.get("components", {}).get("schemas", {})
        schemas.pop("HTTPValidationError", None)
        schemas.pop("ValidationError", None)
        for path_item in schema.get("paths", {}).values():
            for operation in path_item.values():
                if isinstance(operation, dict):
                    _rewrite_error_content_types(operation)
        return schema

    app.openapi = custom_openapi  # type: ignore[method-assign]
    return app
