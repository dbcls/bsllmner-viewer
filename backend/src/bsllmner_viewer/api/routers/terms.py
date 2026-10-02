"""Term search and children."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, version_ref
from bsllmner_viewer.api.deps import FacetSelfExcludeParam, QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.queries import terms as tq
from bsllmner_viewer.api.queries.aggregate import element_counts
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.queries.dimensions import clauses_for, dimension
from bsllmner_viewer.api.schemas import TermChildrenResponse, TermElement, TermHit, TermsResponse, Unit

router = APIRouter(tags=["Terms"])


def _term_dimension(store: StoreDep, field: str):  # type: ignore[no-untyped-def]
    dim = dimension(store.field_set, field)
    if dim.kind != "term":
        raise ApiError("invalid-dimension", 400, f"{field!r} is not an annotation field")
    return dim


@router.get(
    "/terms",
    operation_id="searchTerms",
    response_model=TermsResponse,
    summary="Search the terms annotated in a field, or in every annotation field",
    description=(
        "Hits are ordered by how they match `query`: a label or an ID equal to it, then a label or an ID that contains "
        "it, then only a synonym that contains it (`matchedSynonym`). Within each of these, hits are ordered by "
        "`count`. The hits within `limit` are the terms assigned directly to the most BioSamples, so that a broad term "
        "counted only through its descendants does not crowd out the terms in use. Each hit is counted in the "
        "population of its own field: with `facetSelfExclude`, the condition without the conjuncts on that field."
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
    facet_self_exclude: FacetSelfExcludeParam = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> TermsResponse:
    names = [f.name for f in store.fields] if field is None else [field]
    dims = [_term_dimension(store, name) for name in names]
    by_field = {dim.name: dim for dim in dims}
    ast = parse_condition(store, q)
    populations = {name: aggregation_population(ast, [name], facet_self_exclude) for name in by_field}
    counts: dict[tuple[str, str], int] = {}
    descendants: dict[tuple[str, str], int] = {}
    with store.cursor() as cur:
        hits = tq.search_terms(cur, list(by_field), query, limit)
        for name, dim in by_field.items():
            ids = [hit.term_id for hit in hits if hit.field == name]
            if not ids:
                continue
            assert dim.annotation_field is not None
            found = element_counts(cur, population(populations[name], store.field_set), dim, ids, unit)
            counts.update({(name, t): n for t, n in found.items()})
            descendants.update({(name, t): n for t, n in tq.descendant_counts(cur, dim.annotation_field, ids).items()})
        paths = tq.path_labels(cur, sorted({hit.term_id for hit in hits}))
    # Candidates come in tier order; within a tier, the shown count decides, and ties keep the candidate order.
    ordered = sorted(hits, key=lambda hit: (hit.tier, -counts.get((hit.field, hit.term_id), 0)))
    return TermsResponse(
        dataset_version=version_ref(store),
        field=field if field is None else dims[0].name,
        query=query,
        population_q=None if field is None else q_of(populations[dims[0].name]),
        unit=unit,
        terms=[
            TermHit(
                field=hit.field,
                term_id=hit.term_id,
                label=hit.label,
                ontology=hit.ontology,
                path=paths.get(hit.term_id, []),
                descendant_count=descendants.get((hit.field, hit.term_id), 0),
                count=counts.get((hit.field, hit.term_id), 0),
                matched_synonym=hit.synonym,
                clauses=clauses_for(by_field[hit.field], hit.term_id),
            )
            for hit in ordered
        ],
    )


@router.get(
    "/terms/children",
    operation_id="listTermChildren",
    response_model=TermChildrenResponse,
    summary="Child terms of a term annotated in a field",
)
def term_children(
    store: StoreDep,
    field: str,
    term_id: Annotated[str, Query(alias="termId")],
    q: QParam = None,
    unit: Annotated[Unit, Query()] = "biosample",
    facet_self_exclude: FacetSelfExcludeParam = False,
) -> TermChildrenResponse:
    dim = _term_dimension(store, field)
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [dim.name], facet_self_exclude)
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
