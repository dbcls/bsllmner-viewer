"""RFC 7807 problem details."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from bsllmner_viewer.dsl.errors import DslError

PROBLEM_TYPE_PREFIX = "/problems/"
MEDIA_TYPE = "application/problem+json"


class Problem(BaseModel):
    type: str
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None


class ApiError(Exception):
    """An error reported to the client as a problem document."""

    def __init__(self, slug: str, title: str, status: int, detail: str | None = None) -> None:
        super().__init__(detail or title)
        self.slug = slug
        self.title = title
        self.status = status
        self.detail = detail


def problem_response(request: Request, *, slug: str, title: str, status: int, detail: str | None) -> JSONResponse:
    body = Problem(
        type=PROBLEM_TYPE_PREFIX + slug, title=title, status=status, detail=detail, instance=str(request.url.path)
    )
    return JSONResponse(body.model_dump(exclude_none=True), status_code=status, media_type=MEDIA_TYPE)


def install_problem_handlers(app: FastAPI) -> None:
    @app.exception_handler(DslError)
    async def _dsl_error(request: Request, exc: DslError) -> JSONResponse:
        return problem_response(
            request, slug=exc.type.value, title="Invalid condition", status=400, detail=_with_column(exc)
        )

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return problem_response(request, slug=exc.slug, title=exc.title, status=exc.status, detail=exc.detail)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        detail = "; ".join(_format_error(e) for e in exc.errors())
        return problem_response(request, slug="invalid-request", title="Invalid request", status=422, detail=detail)


def _with_column(exc: DslError) -> str:
    if f"column {exc.column}" in exc.detail:
        return exc.detail
    return f"{exc.detail} (column {exc.column}, length {exc.length})"


def _format_error(error: dict[str, Any]) -> str:
    location = ".".join(str(p) for p in error.get("loc", ()))
    return f"{location}: {error.get('msg')}"
