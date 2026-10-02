from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

PROBLEM = "https://ddbj.nig.ac.jp/problems/"


def _set(client: TestClient, q: str | None, keyword: str) -> dict[str, object]:
    response = client.post("/api/dsl/keyword", json={"q": q, "keyword": keyword})
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


def _total(client: TestClient, unit: str, q: str | None) -> int:
    params = {"q": q} if q else {}
    return int(client.get(f"/api/entries/{unit}", params=params).json()["pagination"]["total"])


def test_keyword_endpoint_sets_the_keyword_of_an_empty_condition(client: TestClient) -> None:
    body = _set(client, None, "breast cancer")
    assert body["dsl"] == "breast cancer"
    assert body["ast"] == {"op": "free_text", "value": "breast cancer", "is_phrase": False}
    assert set(body) == {"datasetVersion", "dsl", "ast", "labels"}


def test_keyword_endpoint_replaces_the_old_keywords_and_keeps_the_other_clauses(client: TestClient) -> None:
    q = 'old AND disease:"MONDO:0007254" AND NOT liver AND "old phrase" AND library_strategy:RNA-Seq'
    body = _set(client, q, 'new "a phrase"')
    assert body["dsl"] == 'disease:"MONDO:0007254" AND NOT liver AND library_strategy:RNA-Seq AND new AND "a phrase"'


def test_keyword_endpoint_with_an_empty_keyword_removes_the_keywords(client: TestClient) -> None:
    body = _set(client, "old AND organism_id:9606", "")
    assert body["dsl"] == "organism_id:9606"
    assert body["ast"] == {"field": "organism_id", "op": "eq", "value": "9606"}


@pytest.mark.parametrize("keyword", ["", "   ", "+", '""'])
def test_keyword_endpoint_removing_the_only_keyword_gives_an_empty_condition(client: TestClient, keyword: str) -> None:
    body = _set(client, "old", keyword)
    assert body["dsl"] is None
    assert body["ast"] is None
    assert body["labels"] == {}


def test_keyword_endpoint_on_an_empty_condition_and_an_empty_keyword_is_empty(client: TestClient) -> None:
    body = _set(client, None, "")
    assert body["dsl"] is None
    assert body["ast"] is None


def test_keyword_endpoint_does_not_touch_keywords_nested_under_or_and_not(client: TestClient) -> None:
    body = _set(client, "(a OR b) AND NOT c AND d", "z")
    assert body["dsl"] == "(a OR b) AND NOT c AND z"


def test_keyword_endpoint_merges_nested_and_groups_before_replacing(client: TestClient) -> None:
    body = _set(client, "a AND (b AND organism_id:9606)", "z")
    assert body["dsl"] == "organism_id:9606 AND z"


def test_keyword_endpoint_treats_and_or_not_as_ordinary_words(client: TestClient) -> None:
    assert _set(client, None, "liver AND lung OR NOT x")["dsl"] == "liver and lung or not x"


def test_keyword_endpoint_writes_a_word_the_dsl_cannot_write_bare_as_a_phrase(client: TestClient) -> None:
    body = _set(client, None, "HIF-1/2 2020-01-01 a:b")
    assert body["dsl"] == '"HIF-1/2" AND "2020-01-01" AND "a:b"'
    again = _set(client, str(body["dsl"]), "")
    assert again["dsl"] is None


def test_keyword_endpoint_result_is_a_condition_the_entries_endpoint_accepts(client: TestClient) -> None:
    body = _set(client, "organism_id:9606", 'sample "run1 sample"')
    q = str(body["dsl"])
    assert client.get("/api/entries/biosample", params={"q": q}).status_code == 200
    assert _total(client, "biosample", q) == _total(
        client, "biosample", 'organism_id:9606 AND sample AND "run1 sample"'
    )


@pytest.mark.parametrize("keyword", ["hypoxia*", "hyp?xia", "liver *", '"ok" a*b'])
def test_keyword_endpoint_rejects_a_wildcard_with_problem_details(client: TestClient, keyword: str) -> None:
    response = client.post("/api/dsl/keyword", json={"q": "organism_id:9606", "keyword": keyword})
    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"] == PROBLEM + "unexpected-token"
    assert body["title"] == "Bad Request"
    assert body["instance"] == "/api/dsl/keyword"
    assert body["requestId"] == response.headers["x-request-id"]


def test_keyword_endpoint_rejects_an_invalid_q_with_problem_details(client: TestClient) -> None:
    response = client.post("/api/dsl/keyword", json={"q": "nope:x", "keyword": "a"})
    assert response.status_code == 400
    assert response.json()["type"] == PROBLEM + "unknown-field"
    response = client.post("/api/dsl/keyword", json={"q": "disease:(", "keyword": "a"})
    assert response.json()["type"] == PROBLEM + "unexpected-token"


def test_keyword_endpoint_without_the_keyword_field_is_unprocessable(client: TestClient) -> None:
    response = client.post("/api/dsl/keyword", json={"q": "a"})
    assert response.status_code == 422
    assert response.json()["type"] == "about:blank"


def test_keyword_endpoint_accepts_a_long_keyword_without_error(client: TestClient) -> None:
    body = _set(client, None, " ".join(f"w{i}" for i in range(100)))
    assert str(body["dsl"]).startswith("w0 w1 w2")


def test_keyword_whole_word_does_not_match_the_start_of_a_longer_word_but_the_last_word_does(
    client: TestClient,
) -> None:
    assert _total(client, "biosample", "samp") == _total(client, "biosample", None)
    assert _total(client, "biosample", "samp sample") == 0
    assert _total(client, "biosample", "sample samp") == _total(client, "biosample", None)
    assert _total(client, "biosample", "samp AND sample") == _total(client, "biosample", "samp")


def test_keyword_matches_nothing_when_a_word_is_absent_and_under_not_matches_everything(client: TestClient) -> None:
    everything = _total(client, "biosample", None)
    assert _total(client, "biosample", "zzzzzz") == 0
    assert _total(client, "biosample", "NOT zzzzzz") == everything
    assert _total(client, "biosample", "zzzzzz OR sample") == everything


def test_keyword_phrase_needs_its_words_in_sequence(client: TestClient) -> None:
    assert _total(client, "biosample", '"sample of"') == _total(client, "biosample", None)
    assert _total(client, "biosample", '"of sample"') == 0
    assert _total(client, "biosample", "of sample") == _total(client, "biosample", None)


def test_keyword_phrase_does_not_span_two_values(client: TestClient) -> None:
    assert _total(client, "biosample", '"homo sapiens"') > 0
    assert _total(client, "biosample", '"sapiens sample"') == 0
    assert _total(client, "biosample", "sapiens sample") > 0


def test_problem_detail_of_an_error_without_a_span_has_no_position_suffix(client: TestClient) -> None:
    wildcard = client.post("/api/dsl/keyword", json={"q": None, "keyword": "hypoxia*"}).json()
    assert "(column" not in wildcard["detail"]
    assert "hypoxia*" in wildcard["detail"]
    ast = client.post("/api/dsl/serialize", json={"ast": {"op": "XOR"}}).json()
    assert "(column" not in ast["detail"]


def test_problem_detail_of_an_error_with_a_span_keeps_the_position(client: TestClient) -> None:
    for q in ("disease:", "nope:x", "organism_id:abc", "organism_id:9606 AND --"):
        detail = client.get("/api/entries/biosample", params={"q": q}).json()["detail"]
        assert "column" in detail, q
    unknown = client.get("/api/entries/biosample", params={"q": "nope:x"}).json()["detail"]
    assert unknown.count("column") == 1
    ast_keyword = client.post("/api/dsl/serialize", json={"ast": {"op": "free_text", "value": "--"}}).json()
    assert ast_keyword["type"].endswith("/invalid-value")
