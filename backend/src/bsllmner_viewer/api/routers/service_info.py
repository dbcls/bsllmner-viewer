"""Service information."""

from __future__ import annotations

import os
from typing import Literal

from fastapi import APIRouter

from bsllmner_viewer import __version__
from bsllmner_viewer.api.deps import StoreDep
from bsllmner_viewer.api.schemas import ServiceInfoResponse

router = APIRouter(tags=["Service Info"])

COMMIT_ENV = "BSLLMNER_VIEWER_COMMIT"
SERVICE_NAME = "bsllmner-viewer API"
SERVICE_DESCRIPTION = "Queries, aggregations, and exports over ontology-mapped BioSample annotations."


def service_version() -> str:
    commit = os.environ.get(COMMIT_ENV)
    return f"{__version__}+{commit}" if commit else __version__


@router.get(
    "/service-info",
    operation_id="getServiceInfo",
    response_model=ServiceInfoResponse,
    summary="Get service information",
    description=(
        "The name, the version, and the state of the store, for health monitoring. The api starts only with a store "
        "that it can open and whose schema version its code reads, so a missing, invalid, or mismatched store stops "
        "the process at startup. While the api runs, the response has status 200, and `store` is `ok` if the api can "
        "query the store and `unavailable` if a query fails."
    ),
)
def get_service_info(store: StoreDep) -> ServiceInfoResponse:
    try:
        with store.cursor() as cur:
            cur.execute("SELECT 1").fetchone()
        state: Literal["ok", "unavailable"] = "ok"
    except Exception:
        state = "unavailable"
    return ServiceInfoResponse(
        name=SERVICE_NAME, version=service_version(), description=SERVICE_DESCRIPTION, store=state
    )
