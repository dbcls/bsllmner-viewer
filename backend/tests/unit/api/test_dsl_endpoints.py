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


def test_select_that_makes_q_too_long_is_the_problem_of_a_too_long_parse(client: TestClient) -> None:
    q = "disease:" + "a" * (MAX_LENGTH - 8)
    response = client.post("/api/dsl/select", json={"q": q, "clauses": [{"field": "disease", "value": "b"}]})
    assert response.status_code == 400
    assert response.json()["type"] == f"{PROBLEM}unexpected-token"
    assert "too long" in response.json()["detail"]
    assert client.get("/api/dsl/parse", params={"q": q}).status_code == 200


def test_keyword_that_makes_q_too_long_is_the_problem_of_a_too_long_parse(client: TestClient) -> None:
    response = client.post("/api/dsl/keyword", json={"q": None, "keyword": "a" * (MAX_LENGTH + 1)})
    assert response.status_code == 400
    assert response.json()["type"] == f"{PROBLEM}unexpected-token"
    ok = client.post("/api/dsl/keyword", json={"q": None, "keyword": "a" * MAX_LENGTH})
    assert ok.status_code == 200
    assert client.get("/api/dsl/parse", params={"q": ok.json()["dsl"]}).status_code == 200


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
    q = "disease:'" + '"' * (MAX_LENGTH - 10) + "'"
    assert len(q) <= MAX_LENGTH
    response = client.get("/api/dsl/parse", params={"q": q})
    assert response.status_code == 400
    assert "too long" in response.json()["detail"]
