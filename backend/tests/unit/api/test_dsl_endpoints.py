from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.dsl.parser import MAX_LENGTH

PROBLEM = "https://ddbj.nig.ac.jp/problems/"


@pytest.mark.parametrize("q", [" ", "\t", "　", "\n", " \n "])
def test_parse_of_a_blank_q_is_an_unexpected_token_problem(client: TestClient, q: str) -> None:
    response = client.get("/api/dsl/parse", params={"q": q})
    assert response.status_code == 400
    assert response.json()["type"] == f"{PROBLEM}unexpected-token"


@pytest.mark.parametrize("depth", [150, 300, 500])
def test_deeply_nested_q_is_a_nest_depth_problem_not_a_server_error(client: TestClient, depth: int) -> None:
    for q in (
        "(a AND " * depth + "b" + ")" * depth,
        "NOT (" * min(depth, 680) + "disease:a" + ")" * min(depth, 680),
    ):
        for path in ("/api/dsl/parse", "/api/entries/biosample", "/api/distribution"):
            params = {"q": q, "field": "disease"} if path.endswith("distribution") else {"q": q}
            response = client.get(path, params=params)
            assert response.status_code == 400, (path, depth)
            assert response.json()["type"] == f"{PROBLEM}nest-depth-exceeded"


def test_select_that_makes_q_too_long_is_rejected_with_unexpected_token(client: TestClient) -> None:
    q = 'disease:"MONDO:' + "a" * (MAX_LENGTH - 16) + '"'
    response = client.post("/api/dsl/select", json={"q": q, "clauses": [{"field": "disease", "value": "MONDO:b"}]})
    assert response.status_code == 400
    assert response.json()["type"] == f"{PROBLEM}unexpected-token"
    assert "too long" in response.json()["detail"]
    assert client.get("/api/dsl/parse", params={"q": q}).status_code == 200


def test_keyword_that_makes_q_too_long_is_rejected_with_unexpected_token(client: TestClient) -> None:
    q = " OR ".join(["organism_id:9606"] * 205)
    assert len(q) == MAX_LENGTH
    response = client.post("/api/dsl/keyword", json={"q": q, "keyword": "abcdefghijkl"})
    assert response.status_code == 400
    assert response.json()["type"] == f"{PROBLEM}unexpected-token"
    ok = client.post("/api/dsl/keyword", json={"q": None, "keyword": "a" * MAX_LENGTH})
    assert ok.status_code == 200
    assert client.get("/api/dsl/parse", params={"q": ok.json()["dsl"]}).status_code == 200


def test_keyword_longer_than_the_limit_is_unprocessable(client: TestClient) -> None:
    response = client.post("/api/dsl/keyword", json={"q": None, "keyword": "a" * (MAX_LENGTH + 1)})
    assert response.status_code == 422
    assert response.json()["type"] == "about:blank"


@pytest.mark.parametrize("value", ["09606", "+9606", "\uff19\uff16\uff10\uff16", "2147483648", "9" * 39])
def test_organism_id_that_is_not_canonical_is_an_invalid_value_problem(client: TestClient, value: str) -> None:
    for path in ("/api/dsl/parse", "/api/entries/biosample"):
        response = client.get(path, params={"q": f'organism_id:"{value}"'})
        assert response.status_code == 400, (path, value)
        assert response.json()["type"] == f"{PROBLEM}invalid-value"


@pytest.mark.parametrize("q", ["AND cancer", "cancer NOT mouse", "NOT NOT liver"])
def test_parse_returns_a_q_that_parses_to_the_same_ast(client: TestClient, q: str) -> None:
    first = client.get("/api/dsl/parse", params={"q": q}).json()
    second = client.get("/api/dsl/parse", params={"q": first["q"]}).json()
    assert second["ast"] == first["ast"]
    assert second["q"] == first["q"]


def test_parse_whose_canonical_q_is_too_long_is_a_too_long_problem(client: TestClient) -> None:
    q = "disease:'MONDO:" + '"' * (MAX_LENGTH - 16) + "'"
    assert len(q) <= MAX_LENGTH
    response = client.get("/api/dsl/parse", params={"q": q})
    assert response.status_code == 400
    assert response.json()["type"] == f"{PROBLEM}unexpected-token"
    assert "too long" in response.json()["detail"]


def test_select_adds_a_date_value_of_date_published_as_q_writes_it(client: TestClient) -> None:
    clause = {"field": "date_published", "value": "2020-01-01"}
    added = client.post("/api/dsl/select", json={"q": None, "clauses": [clause]})
    assert added.status_code == 200
    assert added.json()["dsl"] == "date_published:2020-01-01"
    assert added.json()["selected"] == [clause]


@pytest.mark.parametrize(
    ("value", "in_q", "slug"),
    [
        ("2020-13-45", "2020-13-45", "invalid-date-format"),
        ("2020-1-1", "2020-1-1", "invalid-operator-for-field"),
        ("", '""', "invalid-operator-for-field"),
    ],
)
def test_select_rejects_a_value_of_date_published_with_the_slug_that_q_gets(
    client: TestClient, value: str, in_q: str, slug: str
) -> None:
    parsed = client.get("/api/dsl/parse", params={"q": f"date_published:{in_q}"})
    selected = client.post("/api/dsl/select", json={"clauses": [{"field": "date_published", "value": value}]})
    assert parsed.status_code == selected.status_code == 400
    assert parsed.json()["type"] == selected.json()["type"] == f"{PROBLEM}{slug}"


@pytest.mark.parametrize(
    ("q", "with_operator"),
    [
        ('"breast cancer" organoid', '"breast cancer" AND organoid'),
        ('organoid "breast cancer"', 'organoid AND "breast cancer"'),
        ('"a" "b"', '"a" AND "b"'),
        ("'a b' x", "'a b' AND x"),
    ],
)
def test_a_phrase_next_to_a_word_without_an_operator_is_an_unexpected_token_problem(
    client: TestClient, q: str, with_operator: str
) -> None:
    for path in ("/api/dsl/parse", "/api/entries/biosample"):
        response = client.get(path, params={"q": q})
        assert response.status_code == 400, (path, q)
        assert response.json()["type"] == f"{PROBLEM}unexpected-token"
    assert client.get("/api/dsl/parse", params={"q": with_operator}).status_code == 200


@pytest.mark.parametrize(
    ("removed", "kept"),
    [("MONDO:0005148", "MONDO:0007254"), ("MONDO:0007254", "MONDO:0005148")],
)
def test_select_that_removes_a_clause_of_one_of_two_groups_of_a_field_returns_the_other_as_selected(
    client: TestClient, removed: str, kept: str
) -> None:
    q = 'disease:"MONDO:0007254" AND disease:"MONDO:0005148"'
    body = client.post("/api/dsl/select", json={"q": q, "clauses": [{"field": "disease", "value": removed}]}).json()
    assert body["dsl"] == f'disease:"{kept}"'
    assert body["selected"] == [{"field": "disease", "value": kept}]
