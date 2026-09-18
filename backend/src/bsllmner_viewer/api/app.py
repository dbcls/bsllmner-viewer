"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bsllmner_viewer import __version__
from bsllmner_viewer.api.problems import install_problem_handlers
from bsllmner_viewer.api.routers import aggregations, dataset, dsl, entries, export, projects, records, terms
from bsllmner_viewer.api.store import Store, store_path_from_env

API_VERSION = "1.0.0"


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
            f"Server version {__version__}."
        ),
        lifespan=lifespan,
        openapi_url="/api/openapi.json",
        docs_url="/api/docs",
        redoc_url=None,
    )
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])
    install_problem_handlers(app)
    for router in (
        dataset.router,
        dsl.router,
        records.router,
        entries.router,
        aggregations.router,
        projects.router,
        terms.router,
        export.router,
    ):
        app.include_router(router, prefix="/api")

    @app.get("/health", include_in_schema=False)
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
