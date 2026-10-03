"""BioProject statistics."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, version_ref
from bsllmner_viewer.api.deps import FacetSelfExcludeParam, PageParam, PerPageParam, QParam, StoreDep, parse_condition
from bsllmner_viewer.api.queries import projects as pq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.schemas import Clause, Pagination, Project, ProjectSort, ProjectsResponse

router = APIRouter(tags=["Projects"])


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
    sort: Annotated[ProjectSort, Query()] = "biosampleCount:desc",
    page: PageParam = 1,
    per_page: PerPageParam = 25,
) -> ProjectsResponse:
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, ["bioproject"], facet_self_exclude)
    pop = population(pop_ast, store.field_set)
    with store.cursor() as cur:
        total = pq.count_projects(cur, pop)
        page_rows = pq.project_page(cur, pop, sort, page, per_page) if (page - 1) * per_page < total else []
    return ProjectsResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        population_q=q_of(pop_ast),
        facet_self_exclude=facet_self_exclude,
        sort=sort,
        pagination=Pagination.of(page, per_page, total),
        items=[
            Project(
                identifier=a,
                title=t,
                biosample_count=nb,
                experiment_count=ne,
                assays=assays,
                clauses=[Clause(field="bioproject", value=a)],
            )
            for a, t, nb, ne, assays in page_rows
        ],
    )
