"""The clauses that parse reports as selected are clauses that select accepts."""

from __future__ import annotations

from fastapi.testclient import TestClient
from hypothesis import assume, given, settings

from bsllmner_viewer.dsl.ast import Node
from tests.api_helpers import condition_q
from tests.strategies import flat_asts


@settings(max_examples=60)
@given(flat_asts)
def test_a_selected_clause_of_parse_is_removed_and_added_again_by_select(client: TestClient, ast: Node | None) -> None:
    q = condition_q(ast)
    assume(q is not None)
    parsed = client.get("/api/dsl/parse", params={"q": q})
    assert parsed.status_code == 200, q
    assume(parsed.json()["selected"])
    selected = parsed.json()["selected"]
    for clause in selected:
        removed = client.post("/api/dsl/select", json={"q": q, "clauses": [clause]})
        assert removed.status_code == 200, (q, clause, removed.text)
        assert removed.json()["selected"] == [c for c in selected if c != clause]
        added = client.post("/api/dsl/select", json={"q": removed.json()["dsl"], "clauses": [clause]})
        assert added.status_code == 200, (q, clause, added.text)
        assert clause in added.json()["selected"]
