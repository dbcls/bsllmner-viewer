"""The default elements of an aggregation are ordered by their count and chosen by the number of BioSamples."""

from __future__ import annotations

from itertools import pairwise

from fastapi.testclient import TestClient
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import Node
from tests.api_helpers import condition_q
from tests.strategies import UNITS, conditions

ORDERED_DIMENSIONS = ("cell_line", "disease", "tissue", "drug", "chip_antigen", "library_strategy", "organism_id")


def _is_non_increasing(counts: list[int]) -> bool:
    return all(a >= b for a, b in pairwise(counts))


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
def test_distribution_default_elements_are_in_non_increasing_count_order(
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
def test_crosstab_default_rows_and_columns_are_in_non_increasing_count_order(
    client: TestClient, ast: Node | None, row: str, col: str, unit: str, excl: bool, limit: int
) -> None:
    if row == col:
        return
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
    assert _is_non_increasing([e["count"] for e in body["rows"]]), body["rows"]
    assert _is_non_increasing([e["count"] for e in body["cols"]]), body["cols"]
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
def test_trend_default_series_are_in_non_increasing_count_order(
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
    # A BioSample and an experiment have one publication year, so the points of a series add up to its count.
    totals = [sum(p["count"] for p in s["points"]) for s in body["series"]]
    assert _is_non_increasing(totals), [(s["value"], t) for s, t in zip(body["series"], totals, strict=True)]


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
