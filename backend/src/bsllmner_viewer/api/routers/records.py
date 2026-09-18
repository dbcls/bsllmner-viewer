"""Record list."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import q_of, version_ref
from bsllmner_viewer.api.deps import QParam, StoreDep, parse_condition
from bsllmner_viewer.api.queries import records as rq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.schemas import RecordsResponse, RecordUnit

router = APIRouter(tags=["records"])


@router.get("/records", response_model=RecordsResponse, summary="Matching records as BioSample or experiment rows")
def get_records(
    store: StoreDep,
    q: QParam = None,
    unit: Annotated[RecordUnit, Query(description="Row unit")] = "biosample",
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=200)] = 25,
) -> RecordsResponse:
    ast = parse_condition(store, q)
    pop = population(ast, store.field_set)
    with store.cursor() as cur:
        total = rq.count_records(cur, pop, unit)
        keys = rq.page_keys(cur, pop, unit, page, per_page)
        rows = rq.record_rows(cur, pop, keys, tuple(f.name for f in store.fields))
    return RecordsResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        unit=unit,
        total=total,
        page=page,
        per_page=per_page,
        records=rows,
    )
