"""Distribution, cross-tabulation, and trend."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Annotated

import duckdb
from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, split_csv, version_ref
from bsllmner_viewer.api.deps import FacetSelfExcludeParam, QParam, StoreDep, parse_condition
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
from bsllmner_viewer.dsl.ast import BoolOp, Node, and_, clause
from bsllmner_viewer.dsl.fields import STATUS_SUFFIX, FieldDef
from bsllmner_viewer.dsl.transform import named_values
from bsllmner_viewer.store.organisms import ORGANISM_NAMES

router = APIRouter(tags=["Aggregations"])

UnitParam = Annotated[Unit, Query(description="Counting unit")]
LimitParam = Annotated[int, Query(ge=1, le=200, description="Number of elements when they are not named")]
MAX_ELEMENTS = 500


NAMED_BY_CONDITION: frozenset[str] = frozenset({"term", "assay", "organism"})


def _elements(
    cur: duckdb.DuckDBPyConnection,
    dim: FieldDef,
    named: str | None,
    ast: Node | None,
    pop: Population,
    limit: int,
) -> list[str]:
    """The named elements, or the default elements followed by the elements that the condition names."""
    elements = split_csv(named)
    if len(elements) > MAX_ELEMENTS:
        raise ApiError("too-many-elements", 400, f"at most {MAX_ELEMENTS} elements per dimension")
    if elements:
        return elements
    chosen = default_elements(cur, dim, pop.cte(), pop.params, limit)
    if dim.kind in NAMED_BY_CONDITION:
        chosen.extend(value for value in named_values(ast, dim.name) if value not in chosen)
    return chosen


def _organisms(store: StoreDep) -> dict[int, str | None]:
    cached = getattr(store, "_organism_names", None)
    if cached is None:
        with store.cursor() as cur:
            rows = cur.execute(ORGANISM_NAMES).fetchall()
        cached = {int(o): n for o, n in rows}
        store._organism_names = cached  # type: ignore[attr-defined]
    return cached


@router.get(
    "/distribution",
    operation_id="getDistribution",
    response_model=DistributionResponse,
    summary="Counts per element of one dimension",
    description=(
        "Elements default to the terms most often annotated directly, followed by the elements that the condition "
        "names, ordered by their count with descendants. For an annotation field the response also carries the "
        "status composition of the field, computed without the conjuncts on the field's term and status dimensions."
    ),
)
def get_distribution(
    store: StoreDep,
    field: str,
    q: QParam = None,
    unit: UnitParam = "biosample",
    facet_self_exclude: FacetSelfExcludeParam = False,
    elements: Annotated[
        str | None, Query(description="Comma-separated elements; omitted means the top elements")
    ] = None,
    limit: LimitParam = 10,
) -> DistributionResponse:
    dim = dimension(store.field_set, field)
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [dim.name], facet_self_exclude)
    pop = population(pop_ast, store.field_set)
    with store.cursor() as cur:
        chosen = _elements(cur, dim, elements, ast, pop, limit)
        total = aggregate.population_total(cur, pop, unit)
        counts = aggregate.element_counts(cur, pop, dim, chosen, unit)
        if not split_csv(elements) and dim.kind in ("term", "assay", "organism"):
            chosen = sorted(chosen, key=lambda e: (-counts.get(e, 0), e))
        labels = labels_for(cur, dim, chosen, _organisms(store))
        out: list[TermElement | Element] = []
        if dim.kind == "term":
            statuses = aggregate.term_status_counts(cur, pop, dim, chosen, unit)
            children = aggregate.has_children(cur, pop, dim, chosen, unit)
            parents = aggregate.parents_within(cur, chosen)
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
                        parents=parents.get(e, []),
                    )
                )
        else:
            out = [
                Element(value=e, label=labels.get(e, e), clauses=clauses_for(dim, e), count=counts.get(e, 0))
                for e in chosen
            ]
        without_term: int | None = None
        if dim.kind == "term" and dim.annotation_field:
            not_mapped = BoolOp("NOT", (clause(dim.annotation_field + STATUS_SUFFIX, "mapped"),))
            without_ast = not_mapped if pop_ast is None else and_(pop_ast, not_mapped)
            without_term = aggregate.population_total(cur, population(without_ast, store.field_set), unit)
    return DistributionResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        population_q=q_of(pop_ast),
        field=dim.name,
        unit=unit,
        facet_self_exclude=facet_self_exclude,
        total=total,
        elements=out,
        without_term=without_term,
    )


@router.get(
    "/crosstab",
    operation_id="getCrosstab",
    response_model=CrosstabResponse,
    summary="Counts per cell of two dimensions with expected counts",
)
def get_crosstab(
    store: StoreDep,
    row: str,
    col: str,
    q: QParam = None,
    unit: UnitParam = "biosample",
    facet_self_exclude: FacetSelfExcludeParam = False,
    row_elements: Annotated[
        str | None, Query(alias="rowElements", description="Comma-separated row elements; omitted means the top rows")
    ] = None,
    col_elements: Annotated[
        str | None,
        Query(alias="colElements", description="Comma-separated column elements; omitted means the top columns"),
    ] = None,
    limit: LimitParam = 10,
) -> CrosstabResponse:
    row_dim = dimension(store.field_set, row)
    col_dim = dimension(store.field_set, col)
    if row_dim.name == col_dim.name:
        raise ApiError("invalid-dimension", 400, f"the row and the column cannot both be {row_dim.name}")
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [row_dim.name, col_dim.name], facet_self_exclude)
    pop = population(pop_ast, store.field_set)
    with store.cursor() as cur:
        rows_chosen = _elements(cur, row_dim, row_elements, ast, pop, limit)
        cols_chosen = _elements(cur, col_dim, col_elements, ast, pop, limit)
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
            ratio = aggregate.ratio_to_expected(observed, expected)
            cells.append(
                Cell(
                    row=r,
                    col=c,
                    count=observed,
                    expected=expected,
                    ratio=ratio,
                    residual=residual,
                    classification=aggregate.classify(observed, expected, ratio, residual),
                )
            )
    return CrosstabResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        population_q=q_of(pop_ast),
        row_field=row_dim.name,
        col_field=col_dim.name,
        unit=unit,
        facet_self_exclude=facet_self_exclude,
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
    """Axis elements; term dimensions carry status counts, whether child terms have counts, and parents on the axis."""
    if dim.kind != "term":
        return [
            Element(value=e, label=labels.get(e, e), clauses=clauses_for(dim, e), count=counts.get(e, 0))
            for e in chosen
        ]
    statuses = aggregate.term_status_counts(cur, pop, dim, chosen, unit)
    children = aggregate.has_children(cur, pop, dim, chosen, unit)
    parents = aggregate.parents_within(cur, chosen)
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
                parents=parents.get(e, []),
            )
        )
    return out


def _year_span(years: Iterable[int]) -> list[int]:
    """Every year from the first to the last, so that a year without matches is a point with a count of 0."""
    present = list(years)
    return list(range(min(present), max(present) + 1)) if present else []


@router.get(
    "/trend",
    operation_id="getTrend",
    response_model=TrendResponse,
    summary="Counts of the condition per BioSample publication year",
    description=(
        "`total` counts the condition per year, computed without the conjuncts on `date_published`. "
        "When `field` is given, `series` counts each element of that dimension per year, computed without the "
        "conjuncts on that dimension as well. `yearFrom` and `yearTo` limit the years returned without changing the "
        "counts or the elements; `firstYear` and `lastYear` are the first and the last year with a match, whatever "
        "the limits. A reversed range returns no years. `allEntries` counts the whole population in the same years, "
        "without `q`."
    ),
)
def get_trend(
    store: StoreDep,
    field: Annotated[str | None, Query(description="Dimension of the series; omitted means no series")] = None,
    q: QParam = None,
    unit: UnitParam = "biosample",
    facet_self_exclude: FacetSelfExcludeParam = False,
    elements: Annotated[
        str | None, Query(description="Comma-separated elements; omitted means the top elements")
    ] = None,
    limit: LimitParam = 5,
    year_from: Annotated[int | None, Query(alias="yearFrom", description="First year to return")] = None,
    year_to: Annotated[int | None, Query(alias="yearTo", description="Last year to return")] = None,
) -> TrendResponse:
    date_dim = dimension(store.field_set, "date_published")
    dim = None if field is None else dimension(store.field_set, field)
    if dim is not None and dim.kind == "date":
        raise ApiError("invalid-dimension", 400, "the trend dimension cannot be date_published")
    ast = parse_condition(store, q)
    total_ast = aggregation_population(ast, [date_dim.name], facet_self_exclude)
    total_pop = population(total_ast, store.field_set)
    series_ast = (
        total_ast if dim is None else aggregation_population(ast, [dim.name, date_dim.name], facet_self_exclude)
    )
    series: list[TrendSeries] = []
    with store.cursor() as cur:
        total_counts = aggregate.trend_total(cur, total_pop, unit)
        all_counts = (
            total_counts if total_ast is None else aggregate.trend_total(cur, population(None, store.field_set), unit)
        )
        span = _year_span(total_counts)
        if dim is not None:
            pop = population(series_ast, store.field_set)
            chosen = _elements(cur, dim, elements, ast, pop, limit)
            series_years, counts = aggregate.trend(cur, pop, dim, chosen, unit)
            span = _year_span([*span, *series_years])
        years = [y for y in span if (year_from is None or y >= year_from) and (year_to is None or y <= year_to)]
        if dim is not None:
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
                            clauses=[*clauses_for(dim, e), *clauses_for(date_dim, str(y))],
                        )
                        for y in years
                    ],
                )
                for e in chosen
            ]
    return TrendResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        unit=unit,
        facet_self_exclude=facet_self_exclude,
        years=years,
        first_year=span[0] if span else None,
        last_year=span[-1] if span else None,
        total=[TrendPoint(year=y, count=total_counts.get(y, 0), clauses=clauses_for(date_dim, str(y))) for y in years],
        all_entries=[
            TrendPoint(year=y, count=all_counts.get(y, 0), clauses=clauses_for(date_dim, str(y))) for y in years
        ],
        total_population_q=q_of(total_ast),
        field=None if dim is None else dim.name,
        population_q=q_of(series_ast),
        series=series,
    )
