"""Term search and children."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, version_ref
from bsllmner_viewer.api.deps import QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.queries import terms as tq
from bsllmner_viewer.api.queries.aggregate import element_counts
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.queries.dimensions import clauses_for, dimension
from bsllmner_viewer.api.schemas import TermChildrenResponse, TermElement, TermHit, TermsResponse, Unit

router = APIRouter(tags=["terms"])


def _term_dimension(store: StoreDep, field: str):  # type: ignore[no-untyped-def]
    dim = dimension(store.field_set, field)
    if dim.kind != "term":
        raise ApiError("invalid-dimension", "Invalid dimension", 400, f"{field!r} is not an annotation field")
    return dim


@router.get(
    "/terms",
    response_model=TermsResponse,
    summary="Search the terms annotated in a field, or in every annotation field",
    description=(
        "Each hit is counted in the population of its own field: with self-exclusion, the condition without the "
        "conjuncts on that field."
    ),
)
def search_terms(
    store: StoreDep,
    field: Annotated[str | None, Query(description="Annotation field; omitted means every annotation field")] = None,
    query: Annotated[
        str, Query(description="Substring of a label, synonym, or term ID; empty lists the most annotated terms")
    ] = "",
    q: QParam = None,
    unit: Annotated[Unit, Query()] = "biosample",
    self_exclusion: Annotated[bool, Query()] = True,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> TermsResponse:
    names = [f.name for f in store.fields] if field is None else [field]
    dims = [_term_dimension(store, name) for name in names]
    by_field = {dim.name: dim for dim in dims}
    ast = parse_condition(store, q)
    populations = {name: aggregation_population(ast, [name], self_exclusion) for name in by_field}
    counts: dict[tuple[str, str], int] = {}
    descendants: dict[tuple[str, str], int] = {}
    with store.cursor() as cur:
        hits = tq.search_terms(cur, list(by_field), query, limit)
        for name, dim in by_field.items():
            ids = [t for f, t, _, _ in hits if f == name]
            if not ids:
                continue
            assert dim.annotation_field is not None
            found = element_counts(cur, population(populations[name], store.field_set), dim, ids, unit)
            counts.update({(name, t): n for t, n in found.items()})
            descendants.update({(name, t): n for t, n in tq.descendant_counts(cur, dim.annotation_field, ids).items()})
        paths = tq.path_labels(cur, sorted({t for _, t, _, _ in hits}))
    return TermsResponse(
        dataset_version=version_ref(store),
        field=field if field is None else dims[0].name,
        query=query,
        population_q=None if field is None else q_of(populations[dims[0].name]),
        unit=unit,
        terms=[
            TermHit(
                field=f,
                term_id=t,
                label=label,
                ontology=ontology,
                path=paths.get(t, []),
                n_descendants=descendants.get((f, t), 0),
                count=counts.get((f, t), 0),
                clauses=clauses_for(by_field[f], t),
            )
            for f, t, label, ontology in hits
        ],
    )


@router.get(
    "/terms/children", response_model=TermChildrenResponse, summary="Child terms of a term annotated in a field"
)
def term_children(
    store: StoreDep,
    field: str,
    term_id: str,
    q: QParam = None,
    unit: Annotated[Unit, Query()] = "biosample",
    self_exclusion: Annotated[bool, Query()] = True,
) -> TermChildrenResponse:
    dim = _term_dimension(store, field)
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [dim.name], self_exclusion)
    pop = population(pop_ast, store.field_set)
    assert dim.annotation_field is not None
    with store.cursor() as cur:
        children = tq.children_of(cur, dim.annotation_field, term_id)
        ids = [c[0] for c in children]
        counts, statuses, has_kids = tq.counted_elements(cur, pop, dim, ids, unit)
    return TermChildrenResponse(
        dataset_version=version_ref(store),
        field=dim.name,
        term_id=term_id,
        population_q=q_of(pop_ast),
        unit=unit,
        children=[
            TermElement(
                value=t,
                label=label or t,
                clauses=clauses_for(dim, t),
                count=counts.get(t, 0),
                count_exact=statuses.get(t, (0, 0))[0],
                count_selected=statuses.get(t, (0, 0))[1],
                has_children=has_kids.get(t, False),
            )
            for t, label in children
        ],
    )
