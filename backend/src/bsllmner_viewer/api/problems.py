"""RFC 7807 problem details."""

from __future__ import annotations

import http
import logging
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

import duckdb
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from bsllmner_viewer.dsl.errors import DslError

PROBLEM_TYPE_PREFIX = "https://ddbj.nig.ac.jp/problems/"
BLANK_TYPE = "about:blank"
MEDIA_TYPE = "application/problem+json"
REQUEST_ID_HEADER = "X-Request-ID"
RETRY_AFTER_SECONDS = 5

logger = logging.getLogger(__name__)


class ProblemDetails(BaseModel):
    """RFC 7807 problem details of an error response."""

    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, serialize_by_alias=True)

    type: str = Field(
        description=(
            "`about:blank` for an error that the HTTP status describes. Otherwise a URI that ends with the slug of the "
            "rule that the request broke. The description of the 400 response of each operation lists its slugs."
        )
    )
    title: str = Field(description="The HTTP status phrase")
    status: int
    detail: str
    instance: str = Field(description="The path of the request")
    timestamp: str = Field(description="ISO 8601 time in UTC")
    request_id: str = Field(description="The value of the `X-Request-ID` header of the response")


DSL_SLUGS = (
    "unexpected-token",
    "unknown-field",
    "invalid-date-format",
    "invalid-operator-for-field",
    "invalid-value",
    "nest-depth-exceeded",
    "missing-value",
)
AGGREGATION_SLUGS = (*DSL_SLUGS, "invalid-dimension", "invalid-element", "too-many-elements")
BUSY_SLUGS = ("server-busy", "query-timeout", "query-too-large")


def error_responses(
    *, bad_request: tuple[str, ...] = (), not_found: bool = False, busy: bool = False
) -> dict[int | str, dict[str, Any]]:
    """The error responses that one operation can return, for its OpenAPI declaration.

    Every operation can answer 422 (a parameter or a body that the operation does not declare) and 500.
    """
    responses: dict[int | str, dict[str, Any]] = {
        422: {
            "model": ProblemDetails,
            "description": "Unprocessable Entity (the request does not match the operation)",
        },
        500: {"model": ProblemDetails, "description": "Internal Server Error"},
    }
    if bad_request:
        slugs = ", ".join(f"`{slug}`" for slug in bad_request)
        responses[400] = {
            "model": ProblemDetails,
            "description": f"Bad Request (the slug of `type` is one of {slugs})",
        }
    if not_found:
        responses[404] = {"model": ProblemDetails, "description": "Not Found"}
    if busy:
        slugs = ", ".join(f"`{slug}`" for slug in BUSY_SLUGS)
        responses[503] = {
            "model": ProblemDetails,
            "description": f"Service Unavailable (the slug of `type` is one of {slugs})",
        }
    return responses


class ApiError(Exception):
    """An error reported to the client as a problem document.

    A slug of None reports the error as `about:blank`, which is for errors that the HTTP status describes.
    """

    def __init__(self, slug: str | None, status: int, detail: str, headers: Mapping[str, str] | None = None) -> None:
        super().__init__(detail)
        self.slug = slug
        self.status = status
        self.detail = detail
        self.headers = headers


def status_title(status: int) -> str:
    try:
        return http.HTTPStatus(status).phrase
    except ValueError:
        return "Error"


def request_id_of(request: Request) -> str:
    request_id: str | None = getattr(request.state, "request_id", None)
    return request_id or str(uuid.uuid4())


def problem_response(
    request: Request, *, slug: str | None, status: int, detail: str, headers: Mapping[str, str] | None = None
) -> JSONResponse:
    request_id = request_id_of(request)
    body = ProblemDetails(
        type=BLANK_TYPE if slug is None else PROBLEM_TYPE_PREFIX + slug,
        title=status_title(status),
        status=status,
        detail=detail,
        instance=str(request.url.path),
        timestamp=datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        request_id=request_id,
    )
    return JSONResponse(
        body.model_dump(by_alias=True),
        status_code=status,
        media_type=MEDIA_TYPE,
        headers={**(headers or {}), REQUEST_ID_HEADER: request_id},
    )


def install_problem_handlers(app: FastAPI) -> None:
    @app.exception_handler(DslError)
    async def _dsl_error(request: Request, exc: DslError) -> JSONResponse:
        return problem_response(request, slug=exc.type.value, status=400, detail=_with_column(exc))

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return problem_response(request, slug=exc.slug, status=exc.status, detail=exc.detail, headers=exc.headers)

    @app.exception_handler(duckdb.InterruptException)
    async def _query_timeout(request: Request, _exc: duckdb.InterruptException) -> JSONResponse:
        return problem_response(
            request,
            slug="query-timeout",
            status=503,
            detail="the query took too long and was stopped; narrow the condition or retry",
            headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
        )

    @app.exception_handler(duckdb.OutOfMemoryException)
    async def _query_too_large(request: Request, exc: duckdb.OutOfMemoryException) -> JSONResponse:
        logger.warning("Query stopped by the memory limit: %s", exc)
        return problem_response(
            request,
            slug="query-too-large",
            status=503,
            detail="the query needs more memory than the api may use; narrow the condition",
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem_response(request, slug=None, status=exc.status_code, detail=str(exc.detail), headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        for error in errors:
            loc = error.get("loc", ())
            if len(loc) >= 2 and loc[0] == "path" and loc[1] == "type":
                return problem_response(
                    request, slug=None, status=404, detail=f"Unknown entry type: {error.get('input', '')!r}"
                )
        detail = "; ".join(_format_error(e) for e in errors)
        return problem_response(request, slug=None, status=422, detail=detail)


class UnhandledErrorMiddleware:
    """Answer an exception that no handler took with a 500 problem.

    The middleware sits inside the CORS middleware, so the 500 response carries the same headers as every other
    response. An exception after the response has started is raised again, because the response cannot change.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as exc:
            if started:
                raise
            logger.exception("Unhandled exception: %s", exc)
            response = problem_response(Request(scope), slug=None, status=500, detail="An unexpected error occurred.")
            await response(scope, receive, send)


def _with_column(exc: DslError) -> str:
    """The detail with the position in the condition string, unless it has one already or the error has no span."""
    if exc.length == 0 or f"column {exc.column}" in exc.detail:
        return exc.detail
    return f"{exc.detail} (column {exc.column}, length {exc.length})"


def _format_error(error: dict[str, Any]) -> str:
    loc = tuple(error.get("loc", ()))
    if error.get("type") == "json_invalid" and len(loc) == 2 and isinstance(loc[1], int):
        return f"body: invalid JSON at character {loc[1]}"
    location = ".".join(str(p) for p in loc)
    return f"{location}: {error.get('msg')}"
