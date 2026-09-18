"""Distribution, cross-tabulation, and trend."""

from __future__ import annotations

from typing import Annotated

import duckdb
from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, split_csv, version_ref
from bsllmner_viewer.api.deps import QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.queries import aggregate
from bsllmner_viewer.api.queries.core import Population, population
from bsllmner_viewer.api.queries.dimensions import clauses_for, default_elements, dimension, labels_for
from bsllmner_viewer.api.schemas import (
    Cell,
    CrosstabResponse,
    DistributionResponse,
    Element,
    TermElement,
    TrendPoint,
    TrendResponse,
    TrendSeries,
    Unit,
)
from bsllmner_viewer.dsl.fields import STATUS_GROUPS, STATUS_SUFFIX, FieldDef

router = APIRouter(tags=["aggregations"])

UnitParam = Annotated[Unit, Query(description="Counting unit")]
SelfExclusionParam = Annotated[
    bool,
    Query(description="Compute without the top-level conjuncts of q that are only on the aggregation's dimensions"),
]
LimitParam = Annotated[int, Query(ge=1, le=200, description="Number of elements when they are not named")]
MAX_ELEMENTS = 500


def _elements(cur, dim: FieldDef, named: str | None, pop, limit: int, expanded: bool) -> list[str]:  # type: ignore[no-untyped-def]
    elements = split_csv(named)
    if len(elements) > MAX_ELEMENTS:
        raise ApiError("too-many-elements", "Too many elements", 400, f"at most {MAX_ELEMENTS} elements per dimension")
    if elements:
        return elements
    return default_elements(cur, dim, pop.cte(), pop.params, limit, expanded)


def _organisms(store: StoreDep) -> dict[int, str | None]:
    cached = getattr(store, "_organism_names", None)
    if cached is None:
        with store.cursor() as cur:
            rows = cur.execute(
                "SELECT organism_id, any_value(organism_name) FROM biosample WHERE organism_id IS NOT NULL GROUP BY 1"
            ).fetchall()
        cached = {int(o): n for o, n in rows}
        store._organism_names = cached  # type: ignore[attr-defined]
    return cached


@router.get(
    "/distribution",
    response_model=DistributionResponse,
    summary="Counts per element of one dimension",
    description=(
        "Elements default to the terms most often annotated directly, ordered by their count with descendants. "
        "For an annotation field the response also carries the status composition of the field, computed without "
        "the conjuncts on the field's term and status dimensions."
    ),
)
def get_distribution(
    store: StoreDep,
    field: str,
    q: QParam = None,
    unit: UnitParam = "biosample",
    self_exclusion: SelfExclusionParam = True,
    elements: Annotated[
        str | None, Query(description="Comma-separated elements; omitted means the top elements")
    ] = None,
    limit: LimitParam = 10,
    expanded_status: Annotated[
        bool, Query(description="For status dimensions, the six statuses instead of the three groups")
    ] = False,
) -> DistributionResponse:
    dim = dimension(store.field_set, field)
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [dim.name], self_exclusion)
    pop = population(pop_ast, store.field_set)
    with store.cursor() as cur:
        chosen = _elements(cur, dim, elements, pop, limit, expanded_status)
        total = aggregate.population_total(cur, pop, unit)
        counts = aggregate.element_counts(cur, pop, dim, chosen, unit)
        if not split_csv(elements) and dim.kind in ("term", "assay", "organism"):
            chosen = sorted(chosen, key=lambda e: (-counts.get(e, 0), e))
        labels = labels_for(cur, dim, chosen, _organisms(store))
        out: list[TermElement | Element] = []
        if dim.kind == "term":
            statuses = aggregate.term_status_counts(cur, pop, dim, chosen, unit)
            children = aggregate.has_children(cur, dim, chosen)
            for e in chosen:
                exact, selected = statuses.get(e, (0, 0))
                out.append(
                    TermElement(
                        value=e,
                        label=labels.get(e, e),
                        clauses=clauses_for(dim, e),
                        count=counts.get(e, 0),
                        count_exact=exact,
                        count_selected=selected,
                        has_children=children.get(e, False),
                    )
                )
        else:
            out = [
                Element(value=e, label=labels.get(e, e), clauses=clauses_for(dim, e), count=counts.get(e, 0))
                for e in chosen
            ]
        status_elements: list[Element] | None = None
        status_q: str | None = None
        if dim.kind == "term" and dim.annotation_field:
            status_field = dim.annotation_field + STATUS_SUFFIX
            status_dim = dimension(store.field_set, status_field)
            status_ast = aggregation_population(ast, [status_field, dim.name], self_exclusion)
            status_pop = population(status_ast, store.field_set)
            status_q = q_of(status_ast)
            groups: dict[str, tuple[str, ...]] = (
                dict(STATUS_GROUPS) if not expanded_status else {s: (s,) for g in STATUS_GROUPS.values() for s in g}
            )
            group_counts = aggregate.group_status_counts(cur, status_pop, dim.annotation_field, unit, groups)
            status_elements = [
                Element(value=g, label=g.replace("_", " "), clauses=clauses_for(status_dim, g), count=n)
                for g, n in group_counts.items()
            ]
    return DistributionResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        population_q=q_of(pop_ast),
        field=dim.name,
        unit=unit,
        self_exclusion=self_exclusion,
        total=total,
        elements=out,
        status=status_elements,
        status_population_q=status_q,
    )


@router.get(
    "/crosstab", response_model=CrosstabResponse, summary="Counts per cell of two dimensions with expected counts"
)
def get_crosstab(
    store: StoreDep,
    row: str,
    col: str,
    q: QParam = None,
    unit: UnitParam = "biosample",
    self_exclusion: SelfExclusionParam = True,
    row_elements: Annotated[
        str | None, Query(description="Comma-separated row elements; omitted means the top rows")
    ] = None,
    col_elements: Annotated[
        str | None, Query(description="Comma-separated column elements; omitted means the top columns")
    ] = None,
    limit: LimitParam = 10,
) -> CrosstabResponse:
    row_dim = dimension(store.field_set, row)
    col_dim = dimension(store.field_set, col)
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [row_dim.name, col_dim.name], self_exclusion)
    pop = population(pop_ast, store.field_set)
    with store.cursor() as cur:
        rows_chosen = _elements(cur, row_dim, row_elements, pop, limit, False)
        cols_chosen = _elements(cur, col_dim, col_elements, pop, limit, False)
        result = aggregate.crosstab(cur, pop, row_dim, rows_chosen, col_dim, cols_chosen, unit)
        row_labels = labels_for(cur, row_dim, rows_chosen, _organisms(store))
        col_labels = labels_for(cur, col_dim, cols_chosen, _organisms(store))
        row_elements_out = _axis_elements(cur, pop, row_dim, rows_chosen, unit, row_labels, result.row_counts)
        col_elements_out = _axis_elements(cur, pop, col_dim, cols_chosen, unit, col_labels, result.col_counts)
    cells: list[Cell] = []
    for r in rows_chosen:
        for c in cols_chosen:
            observed = result.cells.get((r, c), 0)
            expected, residual = aggregate.expected_and_residual(
                observed, result.row_counts.get(r, 0), result.col_counts.get(c, 0), result.total
            )
            cells.append(
                Cell(
                    row=r,
                    col=c,
                    count=observed,
                    expected=expected,
                    residual=residual,
                    classification=aggregate.classify(observed, expected, residual),
                )
            )
    return CrosstabResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        population_q=q_of(pop_ast),
        row_field=row_dim.name,
        col_field=col_dim.name,
        unit=unit,
        self_exclusion=self_exclusion,
        total=result.total,
        rows=row_elements_out,
        cols=col_elements_out,
        cells=cells,
    )


def _axis_elements(
    cur: duckdb.DuckDBPyConnection,
    pop: Population,
    dim: FieldDef,
    chosen: list[str],
    unit: Unit,
    labels: dict[str, str],
    counts: dict[str, int],
) -> list[TermElement | Element]:
    """Axis elements; term dimensions carry status counts and whether child terms exist."""
    if dim.kind != "term":
        return [
            Element(value=e, label=labels.get(e, e), clauses=clauses_for(dim, e), count=counts.get(e, 0))
            for e in chosen
        ]
    statuses = aggregate.term_status_counts(cur, pop, dim, chosen, unit)
    children = aggregate.has_children(cur, dim, chosen)
    out: list[TermElement | Element] = []
    for e in chosen:
        exact, selected = statuses.get(e, (0, 0))
        out.append(
            TermElement(
                value=e,
                label=labels.get(e, e),
                clauses=clauses_for(dim, e),
                count=counts.get(e, 0),
                count_exact=exact,
                count_selected=selected,
                has_children=children.get(e, False),
            )
        )
    return out


@router.get("/trend", response_model=TrendResponse, summary="Counts per element and BioSample creation year")
def get_trend(
    store: StoreDep,
    field: str,
    q: QParam = None,
    unit: UnitParam = "biosample",
    self_exclusion: SelfExclusionParam = True,
    elements: Annotated[
        str | None, Query(description="Comma-separated elements; omitted means the top elements")
    ] = None,
    limit: LimitParam = 5,
) -> TrendResponse:
    dim = dimension(store.field_set, field)
    if dim.kind == "date":
        raise ApiError("invalid-dimension", "Invalid dimension", 400, "the trend dimension cannot be date_created")
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [dim.name, "date_created"], self_exclusion)
    pop = population(pop_ast, store.field_set)
    with store.cursor() as cur:
        chosen = _elements(cur, dim, elements, pop, limit, False)
        years, counts = aggregate.trend(cur, pop, dim, chosen, unit)
        labels = labels_for(cur, dim, chosen, _organisms(store))
    series = [
        TrendSeries(
            value=e,
            label=labels.get(e, e),
            clauses=clauses_for(dim, e),
            points=[
                TrendPoint(
                    year=y,
                    count=counts.get((e, y), 0),
                    clauses=[*clauses_for(dim, e), *clauses_for(dimension(store.field_set, "date_created"), str(y))],
                )
                for y in years
            ],
        )
        for e in chosen
    ]
    return TrendResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        population_q=q_of(pop_ast),
        field=dim.name,
        unit=unit,
        self_exclusion=self_exclusion,
        years=years,
        series=series,
    )
