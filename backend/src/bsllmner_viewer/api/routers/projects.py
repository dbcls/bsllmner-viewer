"""BioProject statistics."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, split_csv, version_ref
from bsllmner_viewer.api.deps import QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.queries import projects as pq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.schemas import Clause, Project, ProjectsResponse

router = APIRouter(tags=["projects"])
MAX_COMPOSITION_FIELDS = 3


@router.get("/projects", response_model=ProjectsResponse, summary="BioProjects of the matching records")
def get_projects(
    store: StoreDep,
    q: QParam = None,
    self_exclusion: Annotated[bool, Query(description="Ignore the bioproject clauses of q")] = True,
    sort: Annotated[pq.ProjectSort, Query()] = "biosample",
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 25,
    composition_fields: Annotated[
        str | None, Query(description="Comma-separated annotation fields whose composition is returned")
    ] = None,
) -> ProjectsResponse:
    fields = split_csv(composition_fields)
    known = {f.name for f in store.fields}
    for f in fields:
        if f not in known:
            raise ApiError("unknown-field", "Unknown field", 400, f"{f!r} is not an annotation field")
    if len(fields) > MAX_COMPOSITION_FIELDS:
        raise ApiError(
            "too-many-fields", "Too many fields", 400, f"at most {MAX_COMPOSITION_FIELDS} composition fields"
        )
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, ["bioproject"], self_exclusion)
    pop = population(pop_ast, store.field_set)
    with store.cursor() as cur:
        total = pq.count_projects(cur, pop)
        page_rows = pq.project_page(cur, pop, sort, page, per_page)
        comps = pq.compositions(cur, pop, [r[0] for r in page_rows], fields)
    return ProjectsResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        population_q=q_of(pop_ast),
        self_exclusion=self_exclusion,
        total=total,
        page=page,
        per_page=per_page,
        sort=sort,
        composition_fields=fields,
        projects=[
            Project(
                bioproject=a,
                title=t,
                n_biosample=nb,
                n_experiment=ne,
                assays=assays,
                clauses=[Clause(field="bioproject", value=a)],
                composition=comps.get(a, []),
            )
            for a, t, nb, ne, assays in page_rows
        ],
    )
