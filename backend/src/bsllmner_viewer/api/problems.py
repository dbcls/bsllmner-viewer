"""RFC 7807 problem details."""

from __future__ import annotations

import http
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from starlette.exceptions import HTTPException as StarletteHTTPException

from bsllmner_viewer.dsl.errors import DslError, ErrorType

PROBLEM_TYPE_PREFIX = "https://ddbj.nig.ac.jp/problems/"
BLANK_TYPE = "about:blank"
MEDIA_TYPE = "application/problem+json"
REQUEST_ID_HEADER = "X-Request-ID"

_BODY_ERROR_PATHS = ("/api/dsl/select",)

logger = logging.getLogger(__name__)


class ProblemDetails(BaseModel):
    """RFC 7807 problem details of an error response."""

    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, serialize_by_alias=True)

    type: str = Field(description="`about:blank`, or a URI that identifies an error specific to the api")
    title: str = Field(description="The HTTP status phrase")
    status: int
    detail: str
    instance: str = Field(description="The path of the request")
    timestamp: str = Field(description="ISO 8601 time in UTC")
    request_id: str = Field(description="The value of the `X-Request-ID` header of the response")


NOT_FOUND_RESPONSE: dict[int | str, dict[str, Any]] = {404: {"model": ProblemDetails, "description": "Not Found"}}


class ApiError(Exception):
    """An error reported to the client as a problem document.

    A slug of None reports the error as `about:blank`, which is for errors that the HTTP status describes.
    """

    def __init__(self, slug: str | None, status: int, detail: str) -> None:
        super().__init__(detail)
        self.slug = slug
        self.status = status
        self.detail = detail


def status_title(status: int) -> str:
    try:
        return http.HTTPStatus(status).phrase
    except ValueError:
        return "Error"


def request_id_of(request: Request) -> str:
    request_id: str | None = getattr(request.state, "request_id", None)
    return request_id or str(uuid.uuid4())


def problem_response(request: Request, *, slug: str | None, status: int, detail: str) -> JSONResponse:
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
        headers={REQUEST_ID_HEADER: request_id},
    )


def install_problem_handlers(app: FastAPI) -> None:
    @app.exception_handler(DslError)
    async def _dsl_error(request: Request, exc: DslError) -> JSONResponse:
        return problem_response(request, slug=exc.type.value, status=400, detail=_with_column(exc))

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return problem_response(request, slug=exc.slug, status=exc.status, detail=exc.detail)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem_response(request, slug=None, status=exc.status_code, detail=str(exc.detail))

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
        if request.url.path in _BODY_ERROR_PATHS and any(e.get("loc", ("",))[0] == "body" for e in errors):
            return problem_response(request, slug=ErrorType.invalid_ast.value, status=400, detail=detail)
        return problem_response(request, slug=None, status=422, detail=detail)

    @app.exception_handler(Exception)
    async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception: %s", exc)
        return problem_response(request, slug=None, status=500, detail="An unexpected error occurred.")


def _with_column(exc: DslError) -> str:
    """The detail with the position in the condition string, unless it has one already or the error has no span."""
    if exc.length == 0 or f"column {exc.column}" in exc.detail:
        return exc.detail
    return f"{exc.detail} (column {exc.column}, length {exc.length})"


def _format_error(error: dict[str, Any]) -> str:
    location = ".".join(str(p) for p in error.get("loc", ()))
    return f"{location}: {error.get('msg')}"
