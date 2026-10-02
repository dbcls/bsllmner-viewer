from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.synthetic import ONTOLOGIES

SYNONYMS = {term_id: synonyms for terms in ONTOLOGIES.values() for term_id, _, synonyms, _ in terms}
QUERIES = ["", "cancer", "breast", "mammary", "neoplasm", "muscle", "k562", "ad", "e", "MONDO"]
CONDITIONS = [{}, {"q": "library_strategy:RNA-Seq", "unit": "sra-experiment", "facetSelfExclude": "true"}]


def _tier(hit: dict[str, Any], query: str) -> int:
    """0 when the label or the ID is the query, 1 when one of them contains it, 2 when only a synonym does."""
    text = query.casefold()
    label = (hit["label"] or "").casefold()
    term_id = hit["termId"].casefold()
    if text in (label, term_id):
        return 0
    if text in label or text in term_id:
        return 1
    return 2


def _hits(client: TestClient, query: str, **params: str) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = client.get("/api/terms", params={"query": query, "limit": 100, **params}).json()[
        "terms"
    ]
    assert hits, query
    return hits


@pytest.mark.parametrize("params", CONDITIONS)
@pytest.mark.parametrize("query", QUERIES)
def test_terms_search_orders_hits_by_how_they_match_and_then_by_their_shown_count(
    client: TestClient, query: str, params: dict[str, str]
) -> None:
    hits = _hits(client, query, **params)
    keys = [(_tier(hit, query) if query else 0, -hit["count"]) for hit in hits]
    assert keys == sorted(keys)


@pytest.mark.parametrize("query", QUERIES)
def test_terms_search_names_the_synonym_only_when_neither_the_label_nor_the_id_contains_the_query(
    client: TestClient, query: str
) -> None:
    for hit in _hits(client, query):
        if query and _tier(hit, query) == 2:
            assert hit["matchedSynonym"] in SYNONYMS[hit["termId"]]
            assert query.casefold() in hit["matchedSynonym"].casefold()
        else:
            assert hit["matchedSynonym"] is None


def test_terms_search_puts_synonym_only_hits_after_label_hits(client: TestClient) -> None:
    hits = _hits(client, "ad")
    tiers = [_tier(hit, "ad") for hit in hits]
    assert tiers == sorted(tiers)
    assert {1, 2} <= set(tiers)
    by_synonym = next(hit for hit in hits if hit["termId"] == "CHEBI:28748")
    assert by_synonym["matchedSynonym"] == "adriamycin"


def test_terms_search_names_the_matched_synonym_in_its_own_case(client: TestClient) -> None:
    assert [(h["termId"], h["matchedSynonym"]) for h in _hits(client, "k562")] == [("CVCL:0004", "K562")]
    neoplasm = _hits(client, "neoplasm", field="disease")
    assert [(h["termId"], h["matchedSynonym"]) for h in neoplasm] == [("MONDO:0004992", "malignant neoplasm")]
