"""Aggregation invariants documented in docs/api.md, checked through the API."""

from __future__ import annotations

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import FieldClause, Node, Range
from tests.api_helpers import and_clauses, condition_q, count
from tests.strategies import UNITS, conditions, dataset_clauses
from tests.synthetic import ANNOTATED

DIMENSIONS = (
    "cell_line",
    "disease",
    "tissue",
    "drug",
    "chip_antigen",
    "library_strategy",
    "organism_id",
    "date_published",
)


@settings(max_examples=40)
@given(conditions, st.sampled_from(DIMENSIONS), st.sampled_from(UNITS), st.booleans())
def test_element_count_equals_population_and_element(
    client: TestClient, ast: Node | None, dim: str, unit: str, excl: bool
) -> None:
    body = client.get(
        "/api/distribution",
        params={"field": dim, "unit": unit, "q": condition_q(ast) or "", "facetSelfExclude": str(excl).lower()},
    ).json()
    if not excl:
        assert body["populationQ"] == condition_q(ast)
    assert body["total"] == count(client, body["populationQ"], unit)
    for element in body["elements"][:4]:
        assert element["count"] == count(client, and_clauses(body["populationQ"], element["clauses"]), unit), element


@settings(max_examples=25)
@given(conditions, st.sampled_from(UNITS), st.booleans())
def test_crosstab_cells_and_margins_match_counts(client: TestClient, ast: Node | None, unit: str, excl: bool) -> None:
    body = client.get(
        "/api/crosstab",
        params={
            "row": "disease",
            "col": "library_strategy",
            "unit": unit,
            "q": condition_q(ast) or "",
            "limit": 3,
            "facetSelfExclude": str(excl).lower(),
        },
    ).json()
    pop = body["populationQ"]
    for row in body["rows"]:
        assert row["count"] == count(client, and_clauses(pop, row["clauses"]), unit)
    for col in body["cols"]:
        assert col["count"] == count(client, and_clauses(pop, col["clauses"]), unit)
    rows = {r["value"]: r for r in body["rows"]}
    cols = {c["value"]: c for c in body["cols"]}
    for cell in body["cells"][:6]:
        expected = count(client, and_clauses(pop, [*rows[cell["row"]]["clauses"], *cols[cell["col"]]["clauses"]]), unit)
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
            "q": condition_q(ast) or "",
            "limit": 3,
            "facetSelfExclude": str(excl).lower(),
        },
    ).json()
    rows = {r["value"]: r for r in body["rows"]}
    cols = {c["value"]: c for c in body["cols"]}
    for cell in body["cells"][:6]:
        clauses = [*rows[cell["row"]]["clauses"], *cols[cell["col"]]["clauses"]]
        assert cell["count"] == count(client, _narrow(client, body["populationQ"], clauses), unit), cell


@settings(max_examples=25)
@given(conditions, st.sampled_from(UNITS), st.booleans(), st.sampled_from([None, "disease", "library_strategy"]))
def test_trend_points_match_counts(
    client: TestClient, ast: Node | None, unit: str, excl: bool, field: str | None
) -> None:
    params = {"unit": unit, "q": condition_q(ast) or "", "facetSelfExclude": str(excl).lower(), "limit": 2}
    if field:
        params["field"] = field
    body = client.get("/api/trend", params=params).json()
    assert body["years"] == sorted(set(body["years"]))
    assert [p["year"] for p in body["total"]] == body["years"]
    for point in body["total"][:3]:
        assert point["count"] == count(client, and_clauses(body["totalPopulationQ"], point["clauses"]), unit), point
    for series in body["series"]:
        assert [p["year"] for p in series["points"]] == body["years"]
        for point in series["points"][:2]:
            assert point["count"] == count(client, _narrow(client, body["populationQ"], point["clauses"]), unit)


@settings(max_examples=25)
@given(conditions, st.sampled_from(UNITS), st.booleans(), st.sampled_from([None, "disease"]))
def test_trend_all_entries_count_the_whole_population_in_the_years_of_the_trend(
    client: TestClient, ast: Node | None, unit: str, excl: bool, field: str | None
) -> None:
    params = {"unit": unit, "q": condition_q(ast) or "", "facetSelfExclude": str(excl).lower(), "limit": 2}
    if field:
        params["field"] = field
    body = client.get("/api/trend", params=params).json()
    whole = client.get("/api/trend", params={"unit": unit}).json()
    whole_counts = {p["year"]: p["count"] for p in whole["total"]}
    assert [p["year"] for p in body["allEntries"]] == body["years"]
    for point in body["allEntries"]:
        assert point["count"] == whole_counts.get(point["year"], 0), point
    for point in body["allEntries"][:2]:
        assert point["count"] == count(client, and_clauses(None, point["clauses"]), unit), point


years_or_none = st.one_of(st.none(), st.integers(2000, 2030))


@settings(max_examples=25)
@given(conditions, st.sampled_from([None, "disease", "library_strategy"]), years_or_none, years_or_none)
def test_trend_year_range_returns_the_points_of_its_years_and_keeps_the_counts_and_elements(
    client: TestClient, ast: Node | None, field: str | None, year_from: int | None, year_to: int | None
) -> None:
    params: dict[str, str | int] = {"q": condition_q(ast) or "", "facetSelfExclude": "true", "limit": 2}
    if field:
        params["field"] = field
    full = client.get("/api/trend", params=params).json()
    limits = {k: v for k, v in (("yearFrom", year_from), ("yearTo", year_to)) if v is not None}
    response = client.get("/api/trend", params={**params, **limits})
    assert response.status_code == 200
    limited = response.json()

    def inside(year: int) -> bool:
        return (year_from is None or year >= year_from) and (year_to is None or year <= year_to)

    assert limited["years"] == [y for y in full["years"] if inside(y)]
    assert limited["total"] == [p for p in full["total"] if inside(p["year"])]
    assert limited["allEntries"] == [p for p in full["allEntries"] if inside(p["year"])]
    assert [s["value"] for s in limited["series"]] == [s["value"] for s in full["series"]]
    for part, whole in zip(limited["series"], full["series"], strict=True):
        assert part["points"] == [p for p in whole["points"] if inside(p["year"])]
    span = (full["years"][0], full["years"][-1]) if full["years"] else (None, None)
    assert (full["firstYear"], full["lastYear"]) == span
    assert (limited["firstYear"], limited["lastYear"]) == span


@settings(max_examples=30)
@given(conditions, st.sampled_from(["cell_line", "disease", "tissue", "drug", "library_strategy", "organism_id"]))
def test_default_elements_contain_every_value_the_condition_names(
    client: TestClient, ast: Node | None, dim: str
) -> None:
    body = client.get("/api/distribution", params={"field": dim, "q": condition_q(ast) or "", "limit": 1}).json()
    tree = None if ast is None else client.get("/api/dsl/parse", params={"q": condition_q(ast)}).json()["ast"]
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
        "/api/terms",
        params={"query": query, "q": condition_q(ast) or "", "unit": unit, "limit": 6, "facetSelfExclude": flag},
    ).json()
    for hit in body["terms"]:
        single = client.get(
            "/api/terms",
            params={
                "field": hit["field"],
                "query": hit["termId"],
                "q": condition_q(ast) or "",
                "unit": unit,
                "facetSelfExclude": flag,
            },
        ).json()
        assert hit["count"] == count(client, and_clauses(single["populationQ"], hit["clauses"]), unit), hit


@settings(max_examples=25)
@given(conditions, st.sampled_from(sorted(ANNOTATED)), st.sampled_from(UNITS), st.booleans())
def test_without_term_equals_the_population_without_a_mapped_value_of_the_field(
    client: TestClient, ast: Node | None, field: str, unit: str, excl: bool
) -> None:
    body = client.get(
        "/api/distribution",
        params={"field": field, "unit": unit, "q": condition_q(ast) or "", "facetSelfExclude": str(excl).lower()},
    ).json()
    pop = body["populationQ"]
    not_mapped = f"NOT {field}_status:mapped"
    assert body["withoutTerm"] == count(client, not_mapped if pop is None else f"({pop}) AND {not_mapped}", unit)
    if unit != "bioproject":
        with_term = count(client, and_clauses(pop, [{"field": f"{field}_status", "value": "mapped"}]), unit)
        assert body["withoutTerm"] + with_term == body["total"]


@settings(max_examples=20)
@given(conditions, st.sampled_from(["disease", "tissue", "drug"]), st.booleans())
def test_term_count_equals_the_count_of_its_descendant_terms(
    client: TestClient, ast: Node | None, field: str, excl: bool
) -> None:
    flag = str(excl).lower()
    body = client.get(
        "/api/distribution", params={"field": field, "q": condition_q(ast) or "", "limit": 3, "facetSelfExclude": flag}
    ).json()
    for element in body["elements"]:
        children = client.get(
            "/api/terms/children",
            params={"field": field, "termId": element["value"], "q": condition_q(ast) or "", "facetSelfExclude": flag},
        ).json()
        alternatives = " OR ".join(f'{field}:"{c["value"]}"' for c in [element, *children["children"]])
        q = f"({alternatives})" if body["populationQ"] is None else f"({body['populationQ']}) AND ({alternatives})"
        assert element["count"] == count(client, q, "biosample")


@settings(max_examples=30)
@given(conditions, dataset_clauses)
def test_select_twice_restores_the_condition(client: TestClient, ast: Node | None, clause: FieldClause) -> None:
    payload = {"field": clause.field}
    if isinstance(clause.value, Range):
        payload.update({"from": clause.value.from_, "to": clause.value.to})
    else:
        payload["value"] = clause.value
    once = client.post("/api/dsl/select", json={"q": condition_q(ast), "clauses": [payload]}).json()["dsl"]
    twice = client.post("/api/dsl/select", json={"q": once, "clauses": [payload]}).json()["dsl"]
    assert _leaves(client, twice) == _leaves(client, condition_q(ast))


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
def test_parse_of_the_returned_q_returns_the_same_condition_through_the_api(
    client: TestClient, ast: Node | None
) -> None:
    if ast is None:
        return
    parsed = client.get("/api/dsl/parse", params={"q": condition_q(ast)}).json()
    assert client.get("/api/dsl/parse", params={"q": parsed["q"]}).json() == parsed
