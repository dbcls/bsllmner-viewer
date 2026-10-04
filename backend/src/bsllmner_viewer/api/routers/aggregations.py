"""Distribution, cross-tabulation, and trend."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Annotated

import duckdb
from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import aggregation_population, q_of, split_csv, version_ref
from bsllmner_viewer.api.deps import FacetSelfExcludeParam, QParam, StoreDep, UnitParam, parse_condition
from bsllmner_viewer.api.problems import AGGREGATION_SLUGS, ApiError, error_responses
from bsllmner_viewer.api.queries import aggregate
from bsllmner_viewer.api.queries.core import Population, population
from bsllmner_viewer.api.queries.dimensions import (
    NAMED_BY_CONDITION,
    check_elements,
    clauses_for,
    default_elements,
    dimension,
    labels_for,
)
from bsllmner_viewer.api.schemas import (
    MAX_ELEMENTS,
    NAME_MAX_LENGTH,
    Cell,
    CrosstabResponse,
    DistributionResponse,
    TrendPoint,
    TrendResponse,
    TrendSeries,
)
from bsllmner_viewer.dsl.ast import BoolOp, Node, and_, clause
from bsllmner_viewer.dsl.fields import MAPPED, STATUS_SUFFIX, FieldDef, FieldSet
from bsllmner_viewer.dsl.transform import named_values

router = APIRouter(tags=["Aggregations"])

_LIMIT = (
    "Number of default elements, from 1 to 200, when `elements` is omitted. "
    "The elements that `q` names come in addition"
)
LimitParam = Annotated[
    int,
    Query(ge=1, le=200, description=f"{_LIMIT}. It does not apply to `date_published`, which has every year"),
]
TrendLimitParam = Annotated[int, Query(ge=1, le=200, description=_LIMIT)]
CrosstabLimitParam = Annotated[
    int,
    Query(
        ge=1,
        le=MAX_ELEMENTS,
        description=(
            "Number of default elements of each axis, from 1 to 100, when the elements of the axis are omitted. "
            "The elements that `q` names come in addition"
        ),
    ),
]
_ELEMENTS_HEAD = (
    "Comma-separated elements, at most 100. An element is a term ID for an annotation term field, a target assay "
)
_ELEMENTS = (
    f"{_ELEMENTS_HEAD}for `library_strategy`, an NCBI Taxonomy ID for `organism_id`, and a year for `date_published`. "
    'See "Default elements" in /llms-full.txt'
)
_TREND_ELEMENTS = (
    f"{_ELEMENTS_HEAD}for `library_strategy`, and an NCBI Taxonomy ID for `organism_id`. "
    'See "Default elements" in /llms-full.txt'
)
_DIMENSION = (
    "An annotation term field, `library_strategy`, `organism_id`, or `date_published`. "
    "`dslFields` of `GET /api/dataset` lists the fields with their kinds `term`, `assay`, `organism`, and `date`"
)
FieldParam = Annotated[str, Query(max_length=NAME_MAX_LENGTH, description=f"Dimension of the counts. {_DIMENSION}")]
RowParam = Annotated[str, Query(max_length=NAME_MAX_LENGTH, description=f"Dimension of the rows. {_DIMENSION}")]
ColParam = Annotated[
    str,
    Query(
        max_length=NAME_MAX_LENGTH,
        description=f"Dimension of the columns, a field other than `row`. {_DIMENSION}",
    ),
]


def _ordered(dim: FieldDef, named: str | None, chosen: list[str], counts: dict[str, int]) -> list[str]:
    """The elements of a term, assay, or organism axis by count, highest first, and by element for equal counts.

    Organism IDs compare as numbers, as in the query that chooses them. The elements that the request names keep the
    order of the request. The elements of a date axis keep their order.
    """
    if split_csv(named) or dim.kind not in NAMED_BY_CONDITION:
        return chosen
    if dim.kind == "organism":
        return sorted(chosen, key=lambda e: (-counts.get(e, 0), int(e)))
    return sorted(chosen, key=lambda e: (-counts.get(e, 0), e))


def _elements(
    cur: duckdb.DuckDBPyConnection,
    fields: FieldSet,
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
        check_elements(fields, dim, elements)
        return elements
    chosen = default_elements(cur, dim, pop, limit)
    if dim.kind in NAMED_BY_CONDITION:
        chosen.extend(value for value in named_values(ast, dim.name) if value not in chosen)
    return chosen


@router.get(
    "/distribution",
    operation_id="getDistribution",
    responses=error_responses(bad_request=AGGREGATION_SLUGS, busy=True),
    response_model=DistributionResponse,
    summary="Count the population per element of one dimension",
    description=(
        "Counts the population per element of the dimension `field`, in `unit`. The population is `q`, or `q` without "
        "the conjuncts on `field` with `facetSelfExclude`. `total` is the count of the population. An element counts "
        "the units that have its value. For a term dimension, the units have the term or one of its descendants. "
        "The Distribution view of the UI calls this operation once per field. "
        'See "Aggregations" and "Default elements" in /llms-full.txt for the elements and their order.'
    ),
)
def get_distribution(
    store: StoreDep,
    field: FieldParam,
    q: QParam = None,
    unit: UnitParam = "biosample",
    facet_self_exclude: FacetSelfExcludeParam = False,
    elements: Annotated[str | None, Query(description=_ELEMENTS)] = None,
    limit: LimitParam = 10,
) -> DistributionResponse:
    dim = dimension(store.field_set, field)
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [dim.name], facet_self_exclude)
    pop = population(pop_ast, store.field_set)
    with store.cursor(heavy=True) as cur:
        chosen = _elements(cur, store.field_set, dim, elements, ast, pop, limit)
        total = aggregate.population_total(cur, pop, unit)
        counts = aggregate.element_counts(cur, pop, dim, chosen, unit)
        chosen = _ordered(dim, elements, chosen, counts)
        labels = labels_for(cur, dim, chosen, store.organism_names)
        out = aggregate.axis_elements(cur, pop, dim, chosen, unit, labels, counts)
        without_term: int | None = None
        if dim.kind == "term" and dim.annotation_field:
            not_mapped = BoolOp("NOT", (clause(dim.annotation_field + STATUS_SUFFIX, MAPPED),))
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
    responses=error_responses(bad_request=AGGREGATION_SLUGS, busy=True),
    response_model=CrosstabResponse,
    summary="Count the population per cell of two dimensions, with expected counts",
    description=(
        "Counts the population per pair of an element of `row` and an element of `col`, in `unit`. The population is "
        "`q`, or `q` without the conjuncts on `row` and `col` with `facetSelfExclude`. Each cell has the expected "
        "count under independence, the ratio and the residual against it, and a classification. The Heatmap view "
        "of the UI uses this operation. "
        'See "Expected counts in cross-tabulations" in /llms-full.txt for the formulas and the thresholds.'
    ),
)
def get_crosstab(
    store: StoreDep,
    row: RowParam,
    col: ColParam,
    q: QParam = None,
    unit: UnitParam = "biosample",
    facet_self_exclude: FacetSelfExcludeParam = False,
    row_elements: Annotated[
        str | None,
        Query(
            alias="rowElements", description=f"Elements of the rows. Omitted means the default elements. {_ELEMENTS}"
        ),
    ] = None,
    col_elements: Annotated[
        str | None,
        Query(
            alias="colElements", description=f"Elements of the columns. Omitted means the default elements. {_ELEMENTS}"
        ),
    ] = None,
    limit: CrosstabLimitParam = 10,
) -> CrosstabResponse:
    row_dim = dimension(store.field_set, row)
    col_dim = dimension(store.field_set, col)
    if row_dim.name == col_dim.name:
        raise ApiError("invalid-dimension", 400, f"the row and the column cannot both be {row_dim.name}")
    ast = parse_condition(store, q)
    pop_ast = aggregation_population(ast, [row_dim.name, col_dim.name], facet_self_exclude)
    pop = population(pop_ast, store.field_set)
    with store.cursor(heavy=True) as cur:
        rows_chosen = _elements(cur, store.field_set, row_dim, row_elements, ast, pop, limit)
        cols_chosen = _elements(cur, store.field_set, col_dim, col_elements, ast, pop, limit)
        result = aggregate.crosstab(cur, pop, row_dim, rows_chosen, col_dim, cols_chosen, unit)
        rows_chosen = _ordered(row_dim, row_elements, rows_chosen, result.row_counts)
        cols_chosen = _ordered(col_dim, col_elements, cols_chosen, result.col_counts)
        row_labels = labels_for(cur, row_dim, rows_chosen, store.organism_names)
        col_labels = labels_for(cur, col_dim, cols_chosen, store.organism_names)
        row_elements_out = aggregate.axis_elements(cur, pop, row_dim, rows_chosen, unit, row_labels, result.row_counts)
        col_elements_out = aggregate.axis_elements(cur, pop, col_dim, cols_chosen, unit, col_labels, result.col_counts)
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


def _year_span(years: Iterable[int]) -> list[int]:
    """Every year from the first to the last, so that a year without matches is a point with a count of 0."""
    present = list(years)
    return list(range(min(present), max(present) + 1)) if present else []


@router.get(
    "/trend",
    operation_id="getTrend",
    responses=error_responses(bad_request=AGGREGATION_SLUGS, busy=True),
    response_model=TrendResponse,
    summary="Count the population per publication year of the BioSample",
    description=(
        "Counts the population per publication year of the BioSample, in `unit`: `total` for `q`, `series` for each "
        "element of `field`, and `allEntries` for the whole population without `q`. With `facetSelfExclude`, `total` "
        "is counted without the conjuncts on `date_published`, and `series` also without the conjuncts on `field`. "
        "Otherwise both "
        "count `q`. `yearFrom` and `yearTo` limit the years returned without changing the counts or the elements, and "
        "`firstYear` and `lastYear` ignore them. The Trend view of the UI uses this operation. "
        'See "Trend" in /llms-full.txt.'
    ),
)
def get_trend(
    store: StoreDep,
    field: Annotated[
        str | None,
        Query(
            max_length=NAME_MAX_LENGTH,
            description=(
                "Dimension of the series: an annotation term field, `library_strategy`, or `organism_id`. Omitted "
                "means no series. `dslFields` of `GET /api/dataset` lists the fields with their kinds"
            ),
        ),
    ] = None,
    q: QParam = None,
    unit: UnitParam = "biosample",
    facet_self_exclude: FacetSelfExcludeParam = False,
    elements: Annotated[str | None, Query(description=f"Elements of the series. {_TREND_ELEMENTS}")] = None,
    limit: TrendLimitParam = 5,
    year_from: Annotated[
        int | None, Query(alias="yearFrom", description="First year to return; omitted means no lower limit")
    ] = None,
    year_to: Annotated[
        int | None, Query(alias="yearTo", description="Last year to return; omitted means no upper limit")
    ] = None,
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
    with store.cursor(heavy=True) as cur:
        total_counts = aggregate.trend_total(cur, total_pop, unit)
        all_counts = (
            total_counts if total_ast is None else aggregate.trend_total(cur, population(None, store.field_set), unit)
        )
        span = _year_span(total_counts)
        if dim is not None:
            pop = population(series_ast, store.field_set)
            chosen = _elements(cur, store.field_set, dim, elements, ast, pop, limit)
            series_years, counts = aggregate.trend(cur, pop, dim, chosen, unit)
            over_years: dict[str, int] = {}
            for (element, _year), n in counts.items():
                over_years[element] = over_years.get(element, 0) + n
            chosen = _ordered(dim, elements, chosen, over_years)
            span = _year_span([*span, *series_years])
        years = [y for y in span if (year_from is None or y >= year_from) and (year_to is None or y <= year_to)]
        if dim is not None:
            labels = labels_for(cur, dim, chosen, store.organism_names)
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
