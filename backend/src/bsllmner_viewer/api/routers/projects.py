"""BioProject statistics."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, split_csv, version_ref
from bsllmner_viewer.api.deps import FacetSelfExcludeParam, QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.queries import projects as pq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.schemas import Clause, Pagination, Project, ProjectsResponse

router = APIRouter(tags=["Projects"])
MAX_COMPOSITION_FIELDS = 3


@router.get(
    "/projects",
    operation_id="listProjects",
    response_model=ProjectsResponse,
    summary="BioProjects of the matching BioSamples",
)
def get_projects(
    store: StoreDep,
    q: QParam = None,
    facet_self_exclude: FacetSelfExcludeParam = False,
    sort: Annotated[pq.ProjectSort, Query()] = "biosampleCount:desc",
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(alias="perPage", ge=1, le=100)] = 25,
    composition_fields: Annotated[
        str | None,
        Query(alias="compositionFields", description="Comma-separated annotation fields whose composition is returned"),
    ] = None,
) -> ProjectsResponse:
    fields = split_csv(composition_fields)
    known = {f.name for f in store.fields}
    for f in fields:
        if f not in known:
            raise ApiError("unknown-field", 400, f"{f!r} is not an annotation field")
    if len(fields) > MAX_COMPOSITION_FIELDS:
        raise ApiError("too-many-fields", 400, f"at most {MAX_COMPOSITION_FIELDS} composition fields")
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, ["bioproject"], facet_self_exclude)
    pop = population(pop_ast, store.field_set)
    with store.cursor() as cur:
        total = pq.count_projects(cur, pop)
        page_rows = pq.project_page(cur, pop, sort, page, per_page)
        comps = pq.compositions(cur, pop, [r[0] for r in page_rows], fields)
    return ProjectsResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        population_q=q_of(pop_ast),
        facet_self_exclude=facet_self_exclude,
        sort=sort,
        composition_fields=fields,
        pagination=Pagination(page=page, per_page=per_page, total=total, has_next=page * per_page < total),
        items=[
            Project(
                identifier=a,
                title=t,
                biosample_count=nb,
                experiment_count=ne,
                assays=assays,
                clauses=[Clause(field="bioproject", value=a)],
                composition=comps.get(a, []),
            )
            for a, t, nb, ne, assays in page_rows
        ],
    )
