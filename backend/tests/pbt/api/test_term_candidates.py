"""How the term search chooses its terms in the population that it counts them in."""

from __future__ import annotations

from collections import Counter
from typing import Any

from fastapi.testclient import TestClient
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import Node
from tests.api_helpers import condition_q, count, entry_items
from tests.strategies import conditions
from tests.synthetic import ANNOTATED, ONTOLOGIES, term_tier

ONTOLOGY_OF = {
    "cell_line": "cellosaurus",
    "disease": "mondo",
    "tissue": "uberon",
    "drug": "chebi",
    "chip_antigen": "gene",
}
PARENTS = {term_id: set(parents) for terms in ONTOLOGIES.values() for term_id, _, _, parents in terms}
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


def _ancestors(term_id: str) -> set[str]:
    found: set[str] = set()
    todo = [term_id]
    while todo:
        for parent in PARENTS[todo.pop()]:
            if parent not in found:
                found.add(parent)
                todo.append(parent)
    return found


def _descendants(term_id: str) -> set[str]:
    return {t for t in PARENTS if term_id in _ancestors(t)}


@settings(max_examples=25)
@given(conditions, st.sampled_from(sorted(ANNOTATED)), st.sampled_from(QUERIES))
def test_term_search_candidates_are_the_matching_terms_of_the_field_and_their_ancestors(
    client: TestClient, ast: Node | None, field: str, query: str
) -> None:
    direct = _direct_counts(client, None, field)
    used = {t for t, n in direct.items() if n > 0}
    of_field = used.union(*(_ancestors(t) for t in used))
    text = query.casefold()
    expected = {
        term_id
        for term_id, label, synonyms, _ in ONTOLOGIES[ONTOLOGY_OF[field]]
        if term_id in of_field and any(text in name.casefold() for name in [label, term_id, *synonyms])
    }
    body = _terms(client, ast, field, query, 100)
    assert {hit["termId"] for hit in body["terms"]} == expected


@settings(max_examples=150)
@given(conditions, st.sampled_from(sorted(ANNOTATED)), st.sampled_from(QUERIES), st.integers(min_value=1, max_value=5))
def test_term_search_chooses_the_limit_best_candidates_by_match_then_population_then_dataset(
    client: TestClient, ast: Node | None, field: str, query: str, limit: int
) -> None:
    every = _terms(client, ast, field, query, 100)
    in_population = _direct_counts(client, every["populationQ"], field)
    in_dataset = _direct_counts(client, None, field)

    def key(term_id: str) -> tuple[int, int, int]:
        return term_tier(term_id, query), -in_population[term_id], -in_dataset[term_id]

    ranked = sorted((hit["termId"] for hit in every["terms"]), key=key)
    assume(len(ranked) <= limit or key(ranked[limit - 1]) != key(ranked[limit]))
    chosen = _terms(client, ast, field, query, limit)["terms"]
    assert {hit["termId"] for hit in chosen} == set(ranked[:limit])


@settings(max_examples=25)
@given(st.sampled_from(sorted(ANNOTATED)), st.sampled_from(QUERIES))
def test_term_hit_descendant_count_is_the_annotated_descendants_and_zero_means_only_the_term(
    client: TestClient, field: str, query: str
) -> None:
    direct = _direct_counts(client, None, field)
    used = {t for t, n in direct.items() if n > 0}
    for hit in _terms(client, None, field, query, 100)["terms"]:
        term_id = hit["termId"]
        assert hit["descendantCount"] == len(_descendants(term_id) & used), term_id
        if hit["descendantCount"] == 0:
            assert count(client, f'{field}:"{term_id}"') == direct[term_id], term_id
