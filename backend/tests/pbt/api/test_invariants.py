"""Aggregation invariants documented in docs/api.md, checked through the API."""

from __future__ import annotations

from functools import reduce

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import FieldClause, Node, Range, normalize
from bsllmner_viewer.dsl.serializer import serialize
from bsllmner_viewer.dsl.transform import add_clause
from tests.synthetic import ANNOTATED, TARGET_ASSAYS

UNITS = ("biosample", "experiment", "bioproject")
DIMENSIONS = (
    "cell_line",
    "disease",
    "tissue",
    "drug",
    "chip_antigen",
    "disease_status",
    "library_strategy",
    "organism_id",
    "date_created",
)


def _clause(field: str, value: str) -> FieldClause:
    return FieldClause(field=field, value_kind="phrase", value=value)


clauses = st.one_of(
    *[st.sampled_from([_clause(f, t) for t, _ in terms]) for f, terms in ANNOTATED.items()],
    st.sampled_from([_clause("library_strategy", a) for a in TARGET_ASSAYS]),
    st.sampled_from([_clause("organism_id", "9606"), _clause("organism_id", "10090")]),
    st.sampled_from(
        [_clause(f"{f}_status", s) for f in ANNOTATED for s in ("mapped", "unmapped", "no_value", "mapped_exact")]
    ),
    st.builds(
        lambda y: FieldClause("date_created", "range", Range(f"{y}-01-01", f"{y + 3}-12-31")), st.integers(2010, 2022)
    ),
    st.sampled_from([_clause("title", "run1"), _clause("disease_value", "cancer")]),
)
conditions = st.lists(clauses, max_size=3).map(lambda cs: reduce(add_clause, cs, None))


def _q(ast: Node | None) -> str | None:
    return None if ast is None else serialize(normalize(ast))


def _count(client: TestClient, q: str | None, unit: str) -> int:
    params = {"q": q} if q else {}
    if unit == "bioproject":
        lines = client.get("/api/export/accessions", params={**params, "kind": "bioproject"}).text.splitlines()
        return len(lines) - 1
    return int(client.get("/api/records", params={**params, "unit": unit}).json()["total"])


def _and(q: str | None, clauses: list[dict[str, str]]) -> str | None:
    for c in clauses:
        q = _select(q, c)
    return q


def _select(q: str | None, c: dict[str, str]) -> str:
    field = c["field"]
    piece = f"{field}:[{c['from']} TO {c['to']}]" if "from" in c else f'{field}:"{c["value"]}"'
    return piece if q is None else f"({q}) AND {piece}"


@settings(max_examples=40)
@given(conditions, st.sampled_from(DIMENSIONS), st.sampled_from(UNITS), st.booleans())
def test_element_count_equals_population_and_element(
    client: TestClient, ast: Node | None, dim: str, unit: str, excl: bool
) -> None:
    body = client.get(
        "/api/distribution",
        params={"field": dim, "unit": unit, "q": _q(ast) or "", "self_exclusion": str(excl).lower()},
    ).json()
    assert body["population_q"] == (_q(ast) if not excl else body["population_q"])
    assert body["total"] == _count(client, body["population_q"], unit)
    for element in body["elements"][:4]:
        assert element["count"] == _count(client, _and(body["population_q"], element["clauses"]), unit), element


@settings(max_examples=25)
@given(conditions, st.sampled_from(UNITS))
def test_crosstab_cells_and_margins_match_record_counts(client: TestClient, ast: Node | None, unit: str) -> None:
    body = client.get(
        "/api/crosstab",
        params={"row": "disease", "col": "library_strategy", "unit": unit, "q": _q(ast) or "", "limit": 3},
    ).json()
    pop = body["population_q"]
    for row in body["rows"]:
        assert row["count"] == _count(client, _and(pop, row["clauses"]), unit)
    for col in body["cols"]:
        assert col["count"] == _count(client, _and(pop, col["clauses"]), unit)
    rows = {r["value"]: r for r in body["rows"]}
    cols = {c["value"]: c for c in body["cols"]}
    for cell in body["cells"][:6]:
        expected = _count(client, _and(pop, [*rows[cell["row"]]["clauses"], *cols[cell["col"]]["clauses"]]), unit)
        assert cell["count"] == expected, cell


@settings(max_examples=20)
@given(conditions, st.sampled_from(UNITS))
def test_status_group_matches_the_union_of_its_statuses(client: TestClient, ast: Node | None, unit: str) -> None:
    grouped = client.get(
        "/api/distribution", params={"field": "disease_status", "unit": unit, "q": _q(ast) or ""}
    ).json()
    for element in grouped["elements"]:
        assert element["count"] == _count(client, _and(grouped["population_q"], element["clauses"]), unit)


@settings(max_examples=20)
@given(conditions, st.sampled_from(["disease", "tissue", "drug"]))
def test_term_count_equals_the_count_of_its_descendant_terms(client: TestClient, ast: Node | None, field: str) -> None:
    body = client.get("/api/distribution", params={"field": field, "q": _q(ast) or "", "limit": 3}).json()
    for element in body["elements"]:
        children = client.get(
            "/api/terms/children", params={"field": field, "term_id": element["value"], "q": _q(ast) or ""}
        ).json()
        alternatives = " OR ".join(f'{field}:"{c["value"]}"' for c in [element, *children["children"]])
        q = f"({alternatives})" if body["population_q"] is None else f"({body['population_q']}) AND ({alternatives})"
        assert element["count"] == _count(client, q, "biosample")


@settings(max_examples=30)
@given(conditions, clauses)
def test_select_twice_restores_the_condition(client: TestClient, ast: Node | None, clause: FieldClause) -> None:
    payload = {"field": clause.field}
    if isinstance(clause.value, Range):
        payload.update({"from": clause.value.from_, "to": clause.value.to})
    else:
        payload["value"] = clause.value
    once = client.post("/api/dsl/select", json={"q": _q(ast), "clauses": [payload]}).json()["q"]
    twice = client.post("/api/dsl/select", json={"q": once, "clauses": [payload]}).json()["q"]
    assert _leaves(client, twice) == _leaves(client, _q(ast))


def _leaves(client: TestClient, q: str | None) -> set[str]:
    if q is None:
        return set()
    tree = client.get("/api/dsl/parse", params={"q": q}).json()["ast"]
    out: set[str] = set()
    stack = [tree]
    while stack:
        node = stack.pop()
        if "rules" in node:
            stack.extend(node["rules"])
        else:
            out.add(str(sorted(node.items())))
    return out


@settings(max_examples=30)
@given(conditions)
def test_parse_serialize_round_trip_through_the_api(client: TestClient, ast: Node | None) -> None:
    if ast is None:
        return
    parsed = client.get("/api/dsl/parse", params={"q": _q(ast)}).json()
    serialized = client.post("/api/dsl/serialize", json={"ast": parsed["ast"]}).json()
    assert serialized["q"] == parsed["q"]
    assert client.get("/api/dsl/parse", params={"q": serialized["q"]}).json()["ast"] == parsed["ast"]
