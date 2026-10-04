"""BioProject statistics."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, version_ref
from bsllmner_viewer.api.deps import FacetSelfExcludeParam, PageParam, PerPageParam, QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import DSL_SLUGS, error_responses
from bsllmner_viewer.api.queries import projects as pq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.schemas import Clause, Pagination, Project, ProjectSort, ProjectsResponse

router = APIRouter(tags=["Projects"])


@router.get(
    "/projects",
    operation_id="listProjects",
    responses=error_responses(bad_request=DSL_SLUGS, busy=True),
    response_model=ProjectsResponse,
    summary="List the BioProjects of the BioSamples that match a condition",
    description=(
        "Lists the BioProjects of the BioSamples in the population. The population is `q`. With `facetSelfExclude`, "
        "it is `q` without the conjuncts on `bioproject`. `biosampleCount`, `experimentCount`, and `assays` of a "
        "BioProject count only the BioSamples and SRA Experiments of the population, not the whole BioProject. "
        "`pagination.total` is the number of BioProjects. The Projects view of the UI uses this operation. "
        'See "Aggregations" in /llms-full.txt.'
    ),
)
def get_projects(
    store: StoreDep,
    q: QParam = None,
    facet_self_exclude: FacetSelfExcludeParam = False,
    sort: Annotated[
        ProjectSort,
        Query(
            description=(
                "Order of the projects: the count and the direction. Equal counts are ordered by the other count in "
                "the same direction, then by the accession"
            )
        ),
    ] = "biosampleCount:desc",
    page: PageParam = 1,
    per_page: PerPageParam = 25,
) -> ProjectsResponse:
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, ["bioproject"], facet_self_exclude)
    pop = population(pop_ast, store.field_set)
    with store.cursor(heavy=True) as cur:
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
