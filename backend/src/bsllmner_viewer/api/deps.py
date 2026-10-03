"""Request dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.schemas import Unit
from bsllmner_viewer.api.store import Store
from bsllmner_viewer.dsl.ast import Node, normalize
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.validator import validate


def get_store(request: Request) -> Store:
    store: Store = request.app.state.store
    return store


StoreDep = Annotated[Store, Depends(get_store)]


def _query_param_names(dependant: Dependant) -> set[str]:
    names = {param.alias for param in dependant.query_params}
    for sub in dependant.dependencies:
        names |= _query_param_names(sub)
    return names


def reject_unknown_query_params(request: Request) -> None:
    """Answer 422 when the request has a query parameter that its operation does not declare.

    A misspelled parameter would otherwise be ignored, and the response would answer another question than the one
    that the client asked.
    """
    route = request.scope.get("route")
    if not isinstance(route, APIRoute):
        return
    declared = _query_param_names(route.dependant)
    unknown = sorted(set(request.query_params) - declared)
    if unknown:
        accepted = (
            f"the accepted parameters are {', '.join(sorted(declared))}" if declared else "it has no query parameters"
        )
        raise ApiError(None, 422, f"unknown query parameter(s) for this endpoint: {', '.join(unknown)}; {accepted}")


FacetSelfExcludeParam = Annotated[
    bool,
    Query(
        alias="facetSelfExclude",
        description=(
            "If true, compute without the top-level conjuncts of `q` that are only on the dimensions of this "
            "operation, as the screens of the UI do. The description of the operation names its dimensions. "
            'If false, compute from `q` itself. See "Self-exclusion" in /llms-full.txt'
        ),
    ),
]

PageParam = Annotated[
    int, Query(ge=1, description="Page number, starting at 1. A page after the last page has empty `items`")
]
PerPageParam = Annotated[int, Query(alias="perPage", ge=1, le=100, description="Items per page, from 1 to 100")]

UnitParam = Annotated[
    Unit,
    Query(
        description=(
            "Counting unit. `biosample` counts distinct BioSamples, `sra-experiment` distinct SRA Experiments, and "
            '`bioproject` distinct BioProjects. See "Counting" in /llms-full.txt'
        )
    ),
]

QParam = Annotated[
    str | None,
    Query(
        description=(
            'Condition in the condition language: `field:value`, `field:"phrase"`, `field:[a TO b]`, keywords '
            "without a field, `AND`, `OR`, `NOT`, and parentheses. Omitted or empty means the whole population. "
            "The value of an annotation term field is a term ID, which `GET /api/terms` finds, and it matches the "
            "term and its descendants. The value of `<field>_status` is the group `mapped`, `unmapped`, or "
            "`no_value`. The value of `library_strategy` is a target assay of `GET /api/dataset`. A keyword matches "
            "the searchable text of a BioSample, or the entry that has the accession that it spells. "
            'See "Condition DSL" in /llms-full.txt'
        ),
        examples=[
            'disease:"MONDO:0007254"',
            'cell_line:"CVCL:0030" AND library_strategy:ATAC-seq',
            "organism_id:9606 AND date_published:[2015-01-01 TO 2020-12-31]",
            "disease_status:unmapped",
            '"breast cancer" AND NOT organism_id:10090',
        ],
    ),
]


def parse_condition(store: Store, q: str | None) -> Node | None:
    """Parse and validate a condition, or None when q is empty.

    The result has nested groups of the same operator flattened, so that redundant parentheses in `q`
    do not change which conjuncts are at the top level.
    """
    if q is None or not q.strip():
        return None
    ast = parse(q)
    validate(ast, store.field_set)
    return normalize(ast)
