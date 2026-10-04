"""Term search, children, and one term."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, version_ref
from bsllmner_viewer.api.deps import FacetSelfExcludeParam, QParam, StoreDep, UnitParam, parse_condition
from bsllmner_viewer.api.problems import DSL_SLUGS, ApiError, error_responses
from bsllmner_viewer.api.queries import terms as tq
from bsllmner_viewer.api.queries.aggregate import element_counts, term_elements
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.queries.dimensions import clauses_for, dimension
from bsllmner_viewer.api.schemas import (
    NAME_MAX_LENGTH,
    TEXT_MAX_LENGTH,
    TermChildrenResponse,
    TermHit,
    TermOntology,
    TermParent,
    TermResponse,
    TermsResponse,
)
from bsllmner_viewer.api.term_sites import ontology_of, shown_synonyms, term_url

router = APIRouter(tags=["Terms"])


def _term_dimension(store: StoreDep, field: str):  # type: ignore[no-untyped-def]
    found = store.field_set.get(field)
    dim = found if found is not None else dimension(store.field_set, field)
    if dim.kind != "term":
        raise ApiError(
            "invalid-dimension",
            400,
            f"{field!r} is not an annotation field; the annotation fields are "
            f"{', '.join(store.field_set.annotation_fields)}",
        )
    return dim


@router.get(
    "/terms",
    operation_id="searchTerms",
    responses=error_responses(bad_request=(*DSL_SLUGS, "invalid-dimension"), busy=True),
    response_model=TermsResponse,
    summary="Search the terms annotated in a field, or in every annotation field",
    description=(
        "Searches the terms of a field, or of every annotation field, and counts each hit in `unit`. Hits are ordered "
        "by how they match `query`, then by `count`. Each hit is counted in the population of its own field. The "
        "population is `q`. With `facetSelfExclude`, it is `q` without the conjuncts on that field. "
        'See "Default elements" in /llms-full.txt for the hits that `limit` keeps. '
        "Use the `termId` of a hit in a condition."
    ),
)
def search_terms(
    store: StoreDep,
    field: Annotated[
        str | None,
        Query(
            max_length=NAME_MAX_LENGTH,
            description="Annotation field, such as `disease`; omitted means every annotation field",
        ),
    ] = None,
    query: Annotated[
        str,
        Query(
            max_length=TEXT_MAX_LENGTH,
            description=(
                "Text to find in the label, a synonym, or the ID of a term, ignoring letter case; "
                "empty lists the most annotated terms. This is not the condition `q`"
            ),
        ),
    ] = "",
    q: QParam = None,
    unit: UnitParam = "biosample",
    facet_self_exclude: FacetSelfExcludeParam = False,
    limit: Annotated[int, Query(ge=1, le=100, description="Number of hits to return, from 1 to 100")] = 20,
) -> TermsResponse:
    names = [f.name for f in store.fields] if field is None else [field]
    dims = [_term_dimension(store, name) for name in names]
    by_field = {dim.name: dim for dim in dims}
    ast = parse_condition(store, q)
    populations = {name: aggregation_population(ast, [name], facet_self_exclude) for name in by_field}
    pops = {name: population(pop_ast, store.field_set) for name, pop_ast in populations.items()}
    counts: dict[tuple[str, str], int] = {}
    descendants: dict[tuple[str, str], int] = {}
    with store.cursor(heavy=True) as cur:
        hits = tq.search_terms(
            cur, {name: None if populations[name] is None else pops[name] for name in by_field}, query, limit
        )
        for name, dim in by_field.items():
            ids = [hit.term_id for hit in hits if hit.field == name]
            if not ids:
                continue
            assert dim.annotation_field is not None
            found = element_counts(cur, pops[name], dim, ids, unit)
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
    responses=error_responses(bad_request=(*DSL_SLUGS, "invalid-dimension"), not_found=True, busy=True),
    response_model=TermChildrenResponse,
    summary="List the child terms of a term annotated in a field",
    description=(
        "Lists the direct child terms of `termId` that have a count above 0 in the population, in `unit`, in the "
        "order of their direct counts in the whole dataset. `count` of a child includes its descendants. The "
        "population is `q`. With `facetSelfExclude`, it is `q` without the conjuncts on `field`. To expand a term of a "
        "cross-tabulation, pass its `populationQ` as `q`. "
        'See "Aggregations" in /llms-full.txt.'
    ),
)
def term_children(
    store: StoreDep,
    field: Annotated[
        str, Query(max_length=NAME_MAX_LENGTH, description="Annotation field of the term, such as `disease`")
    ],
    term_id: Annotated[
        str, Query(alias="termId", max_length=NAME_MAX_LENGTH, description="ID of the term, such as `MONDO:0007254`")
    ],
    q: QParam = None,
    unit: UnitParam = "biosample",
    facet_self_exclude: FacetSelfExcludeParam = False,
) -> TermChildrenResponse:
    dim = _term_dimension(store, field)
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [dim.name], facet_self_exclude)
    pop = population(pop_ast, store.field_set)
    assert dim.annotation_field is not None
    with store.cursor(heavy=True) as cur:
        if cur.execute("SELECT 1 FROM term WHERE term_id = ?", [term_id]).fetchone() is None:
            raise ApiError(None, 404, f"term {term_id} is not in the dataset")
        listed = tq.children_of(cur, dim.annotation_field, term_id)
        counts = element_counts(cur, pop, dim, [t for t, _ in listed], unit)
        # Only the child terms with a count in the population, as `hasChildren` of the term promises.
        children = [(t, label) for t, label in listed if counts.get(t, 0) > 0]
        elements = term_elements(
            cur, pop, dim, [t for t, _ in children], unit, {t: label or t for t, label in children}, counts
        )
    return TermChildrenResponse(
        dataset_version=version_ref(store),
        field=dim.name,
        term_id=term_id,
        population_q=q_of(pop_ast),
        unit=unit,
        children=elements,
    )


@router.get(
    "/terms/{termId}",
    operation_id="getTerm",
    responses=error_responses(not_found=True),
    response_model=TermResponse,
    summary="Get a term with its synonyms, parents, ontology, and page",
    description=(
        "Returns one term of the dataset: its label, synonyms, direct parent terms, ontology, and the address of its "
        "page. `parents` is empty for a root of an ontology and for a term of an ontology without hierarchy. "
        'See "Term hierarchy" in /llms-full.txt.'
    ),
)
def get_term(
    store: StoreDep,
    term_id: Annotated[
        str, Path(alias="termId", max_length=NAME_MAX_LENGTH, description="ID of the term, such as `UBERON:0000955`")
    ],
) -> TermResponse:
    with store.cursor() as cur:
        row = cur.execute("SELECT label FROM term WHERE term_id = ?", [term_id]).fetchone()
        if row is None:
            raise ApiError(None, 404, f"term {term_id} is not in the dataset")
        synonyms = [
            str(r[0])
            for r in cur.execute(
                "SELECT synonym FROM term_synonym WHERE term_id = ? ORDER BY synonym", [term_id]
            ).fetchall()
        ]
        parents = cur.execute(
            "SELECT p.parent_id, t.label FROM term_parent p JOIN term t ON t.term_id = p.parent_id "
            "WHERE p.term_id = ? ORDER BY lower(t.label), p.parent_id",
            [term_id],
        ).fetchall()
    label = row[0]
    ontology = ontology_of(term_id)
    return TermResponse(
        dataset_version=version_ref(store),
        term_id=term_id,
        label=label,
        ontology=None if ontology is None else TermOntology(prefix=ontology[0], name=ontology[1]),
        synonyms=shown_synonyms(label, synonyms),
        parents=[TermParent(term_id=str(p), label=lab) for p, lab in parents],
        url=term_url(term_id),
    )
