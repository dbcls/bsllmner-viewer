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

UNITS = ("biosample", "sra-experiment", "bioproject")
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
        lines = client.get("/api/export/accessions/bioproject", params=params).text.splitlines()
        return len(lines) - 1
    return int(client.get(f"/api/entries/{unit}", params=params).json()["pagination"]["total"])


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
        params={"field": dim, "unit": unit, "q": _q(ast) or "", "facetSelfExclude": str(excl).lower()},
    ).json()
    if not excl:
        assert body["populationQ"] == _q(ast)
    assert body["total"] == _count(client, body["populationQ"], unit)
    for element in body["elements"][:4]:
        assert element["count"] == _count(client, _and(body["populationQ"], element["clauses"]), unit), element


@settings(max_examples=25)
@given(conditions, st.sampled_from(UNITS), st.booleans())
def test_crosstab_cells_and_margins_match_counts(client: TestClient, ast: Node | None, unit: str, excl: bool) -> None:
    body = client.get(
        "/api/crosstab",
        params={
            "row": "disease",
            "col": "library_strategy",
            "unit": unit,
            "q": _q(ast) or "",
            "limit": 3,
            "facetSelfExclude": str(excl).lower(),
        },
    ).json()
    pop = body["populationQ"]
    for row in body["rows"]:
        assert row["count"] == _count(client, _and(pop, row["clauses"]), unit)
    for col in body["cols"]:
        assert col["count"] == _count(client, _and(pop, col["clauses"]), unit)
    rows = {r["value"]: r for r in body["rows"]}
    cols = {c["value"]: c for c in body["cols"]}
    for cell in body["cells"][:6]:
        expected = _count(client, _and(pop, [*rows[cell["row"]]["clauses"], *cols[cell["col"]]["clauses"]]), unit)
        assert cell["count"] == expected, cell


def _narrow(client: TestClient, q: str | None, clauses: list[dict[str, str]]) -> str | None:
    body = client.post("/api/dsl/select", json={"q": q, "clauses": clauses, "mode": "narrow"}).json()
    return None if body["dsl"] is None else str(body["dsl"])


@settings(max_examples=25)
@given(conditions, st.sampled_from(UNITS), st.booleans())
def test_narrowing_to_a_cell_matches_the_count_of_the_cell(
    client: TestClient, ast: Node | None, unit: str, excl: bool
) -> None:
    body = client.get(
        "/api/crosstab",
        params={
            "row": "disease",
            "col": "library_strategy",
            "unit": unit,
            "q": _q(ast) or "",
            "limit": 3,
            "facetSelfExclude": str(excl).lower(),
        },
    ).json()
    rows = {r["value"]: r for r in body["rows"]}
    cols = {c["value"]: c for c in body["cols"]}
    for cell in body["cells"][:6]:
        clauses = [*rows[cell["row"]]["clauses"], *cols[cell["col"]]["clauses"]]
        assert cell["count"] == _count(client, _narrow(client, body["populationQ"], clauses), unit), cell


@settings(max_examples=25)
@given(conditions, st.sampled_from(UNITS), st.booleans(), st.sampled_from([None, "disease", "library_strategy"]))
def test_trend_points_match_counts(
    client: TestClient, ast: Node | None, unit: str, excl: bool, field: str | None
) -> None:
    params = {"unit": unit, "q": _q(ast) or "", "facetSelfExclude": str(excl).lower(), "limit": 2}
    if field:
        params["field"] = field
    body = client.get("/api/trend", params=params).json()
    assert body["years"] == sorted(set(body["years"]))
    assert [p["year"] for p in body["total"]] == body["years"]
    for point in body["total"][:3]:
        assert point["count"] == _count(client, _and(body["totalPopulationQ"], point["clauses"]), unit), point
    for series in body["series"]:
        assert [p["year"] for p in series["points"]] == body["years"]
        for point in series["points"][:2]:
            assert point["count"] == _count(client, _narrow(client, body["populationQ"], point["clauses"]), unit)


@settings(max_examples=30)
@given(conditions, st.sampled_from(["cell_line", "disease", "tissue", "drug", "library_strategy", "organism_id"]))
def test_default_elements_contain_every_value_the_condition_names(
    client: TestClient, ast: Node | None, dim: str
) -> None:
    body = client.get("/api/distribution", params={"field": dim, "q": _q(ast) or "", "limit": 1}).json()
    tree = None if ast is None else client.get("/api/dsl/parse", params={"q": _q(ast)}).json()["ast"]
    conjuncts = [] if tree is None else tree["rules"] if tree.get("op") == "AND" else [tree]
    named = set()
    for conj in conjuncts:
        leaves = conj["rules"] if conj.get("op") == "OR" else [conj]
        if all("rules" not in leaf and leaf.get("field") == dim for leaf in leaves):
            named |= {leaf["value"] for leaf in leaves if "value" in leaf}
    assert named <= {e["value"] for e in body["elements"]}


@settings(max_examples=20)
@given(
    conditions,
    st.sampled_from(["", "cancer", "c", "MONDO", "liver", "dex", "CVCL:0031"]),
    st.sampled_from(UNITS),
    st.booleans(),
)
def test_term_hits_match_counts_in_the_population_of_their_field(
    client: TestClient, ast: Node | None, query: str, unit: str, excl: bool
) -> None:
    flag = str(excl).lower()
    body = client.get(
        "/api/terms", params={"query": query, "q": _q(ast) or "", "unit": unit, "limit": 6, "facetSelfExclude": flag}
    ).json()
    for hit in body["terms"]:
        single = client.get(
            "/api/terms",
            params={
                "field": hit["field"],
                "query": hit["termId"],
                "q": _q(ast) or "",
                "unit": unit,
                "facetSelfExclude": flag,
            },
        ).json()
        assert hit["count"] == _count(client, _and(single["populationQ"], hit["clauses"]), unit), hit


@settings(max_examples=20)
@given(conditions, st.sampled_from(UNITS), st.booleans())
def test_status_group_matches_the_union_of_its_statuses(
    client: TestClient, ast: Node | None, unit: str, excl: bool
) -> None:
    grouped = client.get(
        "/api/distribution",
        params={"field": "disease_status", "unit": unit, "q": _q(ast) or "", "facetSelfExclude": str(excl).lower()},
    ).json()
    for element in grouped["elements"]:
        assert element["count"] == _count(client, _and(grouped["populationQ"], element["clauses"]), unit)


@settings(max_examples=20)
@given(conditions, st.sampled_from(["disease", "tissue", "drug"]), st.booleans())
def test_term_count_equals_the_count_of_its_descendant_terms(
    client: TestClient, ast: Node | None, field: str, excl: bool
) -> None:
    flag = str(excl).lower()
    body = client.get(
        "/api/distribution", params={"field": field, "q": _q(ast) or "", "limit": 3, "facetSelfExclude": flag}
    ).json()
    for element in body["elements"]:
        children = client.get(
            "/api/terms/children",
            params={"field": field, "termId": element["value"], "q": _q(ast) or "", "facetSelfExclude": flag},
        ).json()
        alternatives = " OR ".join(f'{field}:"{c["value"]}"' for c in [element, *children["children"]])
        q = f"({alternatives})" if body["populationQ"] is None else f"({body['populationQ']}) AND ({alternatives})"
        assert element["count"] == _count(client, q, "biosample")


@settings(max_examples=30)
@given(conditions, clauses)
def test_select_twice_restores_the_condition(client: TestClient, ast: Node | None, clause: FieldClause) -> None:
    payload = {"field": clause.field}
    if isinstance(clause.value, Range):
        payload.update({"from": clause.value.from_, "to": clause.value.to})
    else:
        payload["value"] = clause.value
    once = client.post("/api/dsl/select", json={"q": _q(ast), "clauses": [payload]}).json()["dsl"]
    twice = client.post("/api/dsl/select", json={"q": once, "clauses": [payload]}).json()["dsl"]
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
    assert serialized["dsl"] == parsed["q"]
    assert client.get("/api/dsl/parse", params={"q": serialized["dsl"]}).json()["ast"] == parsed["ast"]
