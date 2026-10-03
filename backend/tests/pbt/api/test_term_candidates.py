"""How the term search chooses its terms in the population of their field, as documented in docs/api.md."""

from __future__ import annotations

from collections import Counter
from typing import Any

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import Node
from tests.api_helpers import condition_q, entry_items
from tests.strategies import conditions
from tests.synthetic import ANNOTATED, term_tier

QUERIES = ["cancer", "carcinoma", "breast", "c", "e", "MONDO", "liver", "dex", "k562", "CVCL"]


def _terms(client: TestClient, ast: Node | None, field: str, query: str, limit: int) -> dict[str, Any]:
    params = {"field": field, "query": query, "q": condition_q(ast) or "", "limit": limit, "facetSelfExclude": "true"}
    body: dict[str, Any] = client.get("/api/terms", params=params).json()
    return body


def _direct_counts(client: TestClient, q: str | None, field: str) -> Counter[str]:
    """BioSamples of the population per term assigned directly to the field, read from the entries of the population."""
    counts: Counter[str] = Counter()
    for item in entry_items(client, q):
        counts.update({a["termId"] for a in item["annotations"].get(field, []) if a["termId"]})
    return counts


@settings(max_examples=25)
@given(conditions, st.sampled_from(sorted(ANNOTATED)), st.integers(min_value=1, max_value=4))
def test_term_hits_without_query_are_the_terms_assigned_directly_to_the_most_biosamples_of_the_population(
    client: TestClient, ast: Node | None, field: str, limit: int
) -> None:
    body = _terms(client, ast, field, "", limit)
    direct = _direct_counts(client, body["populationQ"], field)
    expected = sorted((t for t, n in direct.items() if n > 0), key=lambda t: (-direct[t], t))[:limit]
    assert {hit["termId"] for hit in body["terms"]} == set(expected)


@settings(max_examples=25)
@given(conditions, st.sampled_from(sorted(ANNOTATED)), st.sampled_from(QUERIES))
def test_term_hits_with_query_are_the_same_terms_under_any_condition(
    client: TestClient, ast: Node | None, field: str, query: str
) -> None:
    found = {hit["termId"] for hit in _terms(client, ast, field, query, 100)["terms"]}
    assert found == {hit["termId"] for hit in _terms(client, None, field, query, 100)["terms"]}


@settings(max_examples=25)
@given(conditions, st.sampled_from(sorted(ANNOTATED)), st.sampled_from(QUERIES))
def test_term_hit_with_query_and_limit_one_matches_best_and_is_assigned_directly_to_the_most_biosamples(
    client: TestClient, ast: Node | None, field: str, query: str
) -> None:
    every = _terms(client, ast, field, query, 100)
    if not every["terms"]:
        return
    [best] = _terms(client, ast, field, query, 1)["terms"]
    tiers = {hit["termId"]: term_tier(hit["termId"], query) for hit in every["terms"]}
    top_tier = min(tiers.values())
    assert tiers[best["termId"]] == top_tier
    direct = _direct_counts(client, every["populationQ"], field)
    assert direct[best["termId"]] == max(direct[t] for t, tier in tiers.items() if tier == top_tier)
