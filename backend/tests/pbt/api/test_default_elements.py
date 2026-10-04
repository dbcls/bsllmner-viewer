"""The default elements of an aggregation are ordered by their count and chosen by the number of BioSamples."""

from __future__ import annotations

from collections import Counter

from fastapi.testclient import TestClient
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import Node
from tests.api_helpers import condition_q, entry_items
from tests.strategies import UNITS, conditions

ORDERED_DIMENSIONS = ("cell_line", "disease", "tissue", "drug", "chip_antigen", "library_strategy", "organism_id")


def _element_key(dim: str, value: str) -> int | str:
    """Organism IDs compare as numbers among elements of equal count, and other elements as strings."""
    return int(value) if dim == "organism_id" else value


@settings(max_examples=40)
@given(
    conditions,
    st.sampled_from(ORDERED_DIMENSIONS),
    st.sampled_from(UNITS),
    st.booleans(),
    st.integers(min_value=1, max_value=12),
)
def test_distribution_default_elements_are_in_count_order_with_ties_in_element_order(
    client: TestClient, ast: Node | None, dim: str, unit: str, excl: bool, limit: int
) -> None:
    body = client.get(
        "/api/distribution",
        params={
            "field": dim,
            "unit": unit,
            "q": condition_q(ast) or "",
            "limit": limit,
            "facetSelfExclude": str(excl).lower(),
        },
    ).json()
    values = [e["value"] for e in body["elements"]]
    counts = {e["value"]: e["count"] for e in body["elements"]}
    assert values == sorted(values, key=lambda v: (-counts[v], _element_key(dim, v))), body["elements"]


@settings(max_examples=40)
@given(
    conditions,
    st.sampled_from(ORDERED_DIMENSIONS),
    st.sampled_from(ORDERED_DIMENSIONS),
    st.sampled_from(UNITS),
    st.booleans(),
    st.integers(min_value=1, max_value=12),
)
def test_crosstab_default_rows_and_columns_are_in_count_order_with_ties_in_element_order_and_the_cells_follow_them(
    client: TestClient, ast: Node | None, row: str, col: str, unit: str, excl: bool, limit: int
) -> None:
    assume(row != col)
    body = client.get(
        "/api/crosstab",
        params={
            "row": row,
            "col": col,
            "unit": unit,
            "q": condition_q(ast) or "",
            "limit": limit,
            "facetSelfExclude": str(excl).lower(),
        },
    ).json()
    for dim, elements in ((row, body["rows"]), (col, body["cols"])):
        values = [e["value"] for e in elements]
        counts = {e["value"]: e["count"] for e in elements}
        assert values == sorted(values, key=lambda v: (-counts[v], _element_key(dim, v))), elements
    assert [(c["row"], c["col"]) for c in body["cells"]] == [
        (r["value"], c["value"]) for r in body["rows"] for c in body["cols"]
    ]


@settings(max_examples=40)
@given(
    conditions,
    st.sampled_from(ORDERED_DIMENSIONS),
    st.sampled_from(("biosample", "sra-experiment")),
    st.booleans(),
    st.integers(min_value=1, max_value=12),
)
def test_trend_default_series_are_in_count_order_with_ties_in_element_order(
    client: TestClient, ast: Node | None, dim: str, unit: str, excl: bool, limit: int
) -> None:
    body = client.get(
        "/api/trend",
        params={
            "field": dim,
            "unit": unit,
            "q": condition_q(ast) or "",
            "limit": limit,
            "facetSelfExclude": str(excl).lower(),
        },
    ).json()
    # A BioSample and an SRA Experiment have one publication year, so the points of a series add up to its count.
    totals = {s["value"]: sum(p["count"] for p in s["points"]) for s in body["series"]}
    values = [s["value"] for s in body["series"]]
    assert values == sorted(values, key=lambda v: (-totals[v], _element_key(dim, v))), totals


@settings(max_examples=40)
@given(
    conditions,
    st.sampled_from(("library_strategy", "organism_id")),
    st.sampled_from(UNITS),
    st.integers(min_value=1, max_value=4),
)
def test_assay_and_organism_default_elements_are_the_ones_with_the_most_biosamples(
    client: TestClient, ast: Node | None, dim: str, unit: str, limit: int
) -> None:
    q = condition_q(ast) or ""
    assume(dim not in q)  # a condition that names elements of the dimension adds them to the default ones
    params = {"field": dim, "q": q}
    every = client.get("/api/distribution", params={**params, "limit": 200, "unit": "biosample"}).json()
    # The distribution orders by its own unit, so the BioSample unit is the one that the choice follows.
    expected_counts = sorted((e["count"] for e in every["elements"]), reverse=True)[:limit]
    chosen = client.get("/api/distribution", params={**params, "limit": limit, "unit": "biosample"}).json()
    assert [e["count"] for e in chosen["elements"]] == expected_counts
    other = client.get("/api/distribution", params={**params, "limit": limit, "unit": unit}).json()
    by_biosample = {e["value"]: e["count"] for e in every["elements"]}

    def key(v: str) -> tuple[int, int | str]:
        return -by_biosample[v], _element_key(dim, v)

    assert sorted(by_biosample, key=key)[:limit] == sorted((e["value"] for e in other["elements"]), key=key)


def _years(client: TestClient, q: str | None) -> list[str]:
    return sorted({item["datePublished"][:4] for item in entry_items(client, q) if item["datePublished"]})


@settings(max_examples=25)
@given(
    conditions,
    st.sampled_from(("biosample", "sra-experiment")),
    st.booleans(),
    st.integers(min_value=1, max_value=4),
    st.booleans(),
)
def test_date_default_elements_are_every_year_with_a_match_in_ascending_order(
    client: TestClient, ast: Node | None, unit: str, excl: bool, limit: int, as_row: bool
) -> None:
    params = {"unit": unit, "q": condition_q(ast) or "", "limit": limit, "facetSelfExclude": str(excl).lower()}
    if as_row:
        body = client.get("/api/crosstab", params={**params, "row": "date_published", "col": "library_strategy"}).json()
        values = [e["value"] for e in body["rows"]]
    else:
        body = client.get("/api/distribution", params={**params, "field": "date_published"}).json()
        values = [e["value"] for e in body["elements"]]
    assert values == _years(client, body["populationQ"])


def _direct_term_counts(client: TestClient, q: str | None, field: str) -> Counter[str]:
    """The number of BioSamples of the population that the term is assigned to directly."""
    counts: Counter[str] = Counter()
    for item in entry_items(client, q):
        counts.update({a["termId"] for a in item["annotations"].get(field, []) if a["termId"]})
    return counts


@settings(max_examples=30)
@given(
    conditions,
    st.sampled_from(("cell_line", "disease", "tissue", "drug")),
    st.sampled_from(("distribution", "crosstab", "trend")),
    st.sampled_from(UNITS),
    st.booleans(),
    st.integers(min_value=1, max_value=6),
)
def test_default_terms_of_an_aggregation_are_the_terms_assigned_directly_to_the_most_biosamples(
    client: TestClient, ast: Node | None, field: str, kind: str, unit: str, excl: bool, limit: int
) -> None:
    q = condition_q(ast) or ""
    assume(field not in q)  # a condition that names terms of the field adds them to the default ones
    params = {"unit": unit, "q": q, "limit": limit, "facetSelfExclude": str(excl).lower()}
    if kind == "distribution":
        body = client.get("/api/distribution", params={**params, "field": field}).json()
        chosen = {e["value"] for e in body["elements"]}
    elif kind == "crosstab":
        body = client.get("/api/crosstab", params={**params, "row": field, "col": "library_strategy"}).json()
        chosen = {e["value"] for e in body["rows"]}
    else:
        body = client.get("/api/trend", params={**params, "field": field}).json()
        chosen = {s["value"] for s in body["series"]}
    direct = _direct_term_counts(client, body["populationQ"], field)
    ranked = direct.most_common()
    if len(ranked) > limit:
        assume(ranked[limit - 1][1] != ranked[limit][1])  # a tie at the limit has no single answer
    assert chosen == {term for term, _ in ranked[:limit]}
