from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.api.app import create_app
from bsllmner_viewer.build.ingest import build_full
from bsllmner_viewer.build.manifest import load_manifest
from tests.synthetic import ONTOLOGIES, SYNONYMS, generate, term_tier

QUERIES = ["", "cancer", "breast", "mammary", "neoplasm", "muscle", "k562", "ad", "e", "MONDO", "carcinoma"]
CONDITIONS = [{}, {"q": "library_strategy:RNA-Seq", "unit": "sra-experiment", "facetSelfExclude": "true"}]


def _tier(hit: dict[str, Any], query: str) -> int:
    return term_tier(hit["termId"], query)


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
def test_terms_search_names_the_synonym_only_when_a_synonym_decides_how_the_term_matches(
    client: TestClient, query: str
) -> None:
    for hit in _hits(client, query):
        tier = _tier(hit, query) if query else 0
        if tier in (1, 3):
            assert hit["matchedSynonym"] in SYNONYMS[hit["termId"]]
            assert query.casefold() in hit["matchedSynonym"].casefold()
        else:
            assert hit["matchedSynonym"] is None
        if tier == 1:
            assert hit["matchedSynonym"].casefold() == query.casefold()


def test_terms_search_puts_a_synonym_equal_to_the_query_above_labels_that_contain_it(client: TestClient) -> None:
    hits = _hits(client, "carcinoma", field="disease")
    assert [_tier(hit, "carcinoma") for hit in hits] == [1, 2, 2]
    assert (hits[0]["termId"], hits[0]["matchedSynonym"]) == ("MONDO:0004992", "carcinoma")
    assert {hit["termId"] for hit in hits[1:]} == {"MONDO:0004989", "MONDO:0005061"}


def test_terms_search_puts_synonym_only_hits_after_label_hits(client: TestClient) -> None:
    hits = _hits(client, "ad")
    tiers = [_tier(hit, "ad") for hit in hits]
    assert tiers == sorted(tiers)
    assert {2, 3} <= set(tiers)
    by_synonym = next(hit for hit in hits if hit["termId"] == "CHEBI:28748")
    assert by_synonym["matchedSynonym"] == "adriamycin"


def test_terms_search_names_the_matched_synonym_in_its_own_case(client: TestClient) -> None:
    assert [(h["termId"], h["matchedSynonym"]) for h in _hits(client, "k562")] == [("CVCL:0004", "K562")]
    neoplasm = _hits(client, "neoplasm", field="disease")
    assert [(h["termId"], h["matchedSynonym"]) for h in neoplasm] == [("MONDO:0004992", "malignant neoplasm")]


def test_term_parents_are_the_direct_parents_of_the_ontology_and_empty_for_a_root(client: TestClient) -> None:
    for terms in ONTOLOGIES.values():
        for term_id, _, _, parents in terms:
            response = client.get(f"/api/terms/{term_id}")
            assert response.status_code == 200, term_id
            assert {p["termId"] for p in response.json()["parents"]} == set(parents), term_id
            assert (response.json()["parents"] == []) == (not parents), term_id


ABSENT = "MONDO:9999999"
OBSOLETE = "OBS:1"


@pytest.fixture(scope="module")
def odd_client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[TestClient, dict[str, str]]]:
    """A store whose ontology files have a term of an unknown prefix, and whose run result uses two terms that the
    ontology files do not have: one that is absent and one that every file marks obsolete. Also returns the accession
    of the BioSample that has each of the two."""
    root = tmp_path_factory.mktemp("odd")
    synthetic = generate(root, seed=5, n_biosamples=12, n_runs=2)
    with (root / "ontology" / "gene.obo").open("a") as f:
        f.write("[Term]\nid: GO:0008150\nname: biological process\n\n")
    result = root / "results" / "select_run1.json"
    run2_accessions = {
        e["extract"]["accession"] for e in json.loads((root / "results" / "select_run2.json").read_text())["entries"]
    }
    document = json.loads(result.read_text())
    holders: dict[str, str] = {}
    for term_id, label in ((ABSENT, "absent term"), (OBSOLETE, "obsolete term")):
        for entry in document["entries"]:
            accession = entry["extract"]["accession"]
            items = entry["results"]["tissue"]
            if accession in run2_accessions or accession in holders.values() or not items:
                continue
            items[0].update({"term_id": term_id, "label": label})
            holders[term_id] = accession
            break
    assert set(holders) == {ABSENT, OBSOLETE}
    result.write_text(json.dumps(document))
    store = root / "store" / "odd.duckdb"
    built = build_full(load_manifest(synthetic.manifest), store, workers=1)
    assert built.ok, built.problems
    with TestClient(create_app(store)) as client:
        yield client, holders


def test_term_with_an_unknown_prefix_has_no_url_and_its_prefix_as_the_ontology_name(
    odd_client: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = odd_client
    body = client.get("/api/terms/GO:0008150").json()
    assert body["url"] is None
    assert body["ontology"] == {"prefix": "GO", "name": "GO"}
    assert {"prefix": "GO", "name": "GO"} in client.get("/api/dataset").json()["ontologies"]


@pytest.mark.parametrize("term_id", [ABSENT, OBSOLETE])
def test_term_that_the_reference_does_not_have_matches_by_its_id_and_only_itself(
    odd_client: tuple[TestClient, dict[str, str]], term_id: str
) -> None:
    client, holders = odd_client
    body = client.get(f"/api/terms/{term_id}").json()
    assert client.get(f"/api/terms/{term_id}").status_code == 200
    assert body["label"] == {ABSENT: "absent term", OBSOLETE: "obsolete term"}[term_id]
    assert body["parents"] == []
    items = client.get("/api/entries/biosample", params={"q": f'tissue:"{term_id}"'}).json()["items"]
    assert [item["identifier"] for item in items] == [holders[term_id]]
