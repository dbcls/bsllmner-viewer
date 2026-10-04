"""Invariants of aggregations, checked through the API."""

from __future__ import annotations

import json
import math
from typing import Any

import duckdb
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Node, Range
from bsllmner_viewer.dsl.transform import conjuncts, from_conjuncts, replace_keywords
from tests.api_helpers import accessions, and_clauses, condition_q, count
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
    assert body["total"] == count(client, pop, unit)
    rows = {r["value"]: r for r in body["rows"]}
    cols = {c["value"]: c for c in body["cols"]}
    for cell in body["cells"][:6]:
        expected = count(client, and_clauses(pop, [*rows[cell["row"]]["clauses"], *cols[cell["col"]]["clauses"]]), unit)
        assert cell["count"] == expected, cell


_ANY_YEAR = {"field": "date_published", "from": "1000-01-01", "to": "2999-12-31"}


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
    if unit != "bioproject":
        # A BioSample has one publication year at most, so the points add up to the matches that have a year.
        dated = [_ANY_YEAR]
        assert sum(p["count"] for p in body["total"]) == count(
            client, and_clauses(body["totalPopulationQ"], dated), unit
        )
        for series in body["series"]:
            expected = count(client, and_clauses(body["populationQ"], [*series["clauses"], *dated]), unit)
            assert sum(p["count"] for p in series["points"]) == expected, series["value"]


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
def test_term_count_equals_the_count_of_the_term_and_its_descendants(
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
def test_select_twice_restores_the_clauses_of_the_condition(
    client: TestClient, ast: Node | None, clause: FieldClause
) -> None:
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


def _closure_count(
    store_con: duckdb.DuckDBPyConnection,
    unit: str,
    population: list[str],
    biosamples: list[str],
    field: str,
    term: str,
    status: str,
) -> int:
    """The distinct units of the population that have an annotation of the status at the term or below it."""
    if unit == "biosample":
        sql = (
            "SELECT count(DISTINCT a.biosample) FROM annotation a JOIN term_closure c ON c.descendant = a.term_id "
            "WHERE a.field = ? AND c.ancestor = ? AND a.status = ? AND list_contains(?, a.biosample)"
        )
        row = store_con.execute(sql, [field, term, status, population]).fetchone()
    else:
        sql = (
            "SELECT count(DISTINCT be.experiment) FROM biosample_experiment be "
            "JOIN annotation a ON a.biosample = be.biosample "
            "JOIN term_closure c ON c.descendant = a.term_id "
            "WHERE a.field = ? AND c.ancestor = ? AND a.status = ? "
            "AND list_contains(?, be.experiment) AND list_contains(?, be.biosample)"
        )
        row = store_con.execute(sql, [field, term, status, population, biosamples]).fetchone()
    assert row is not None
    return int(row[0])


@settings(max_examples=30)
@given(
    conditions,
    st.sampled_from(sorted(ANNOTATED)),
    st.sampled_from(("biosample", "sra-experiment")),
    st.booleans(),
)
def test_status_counts_of_an_element_count_units_not_annotations(
    client: TestClient, store_con: duckdb.DuckDBPyConnection, ast: Node | None, field: str, unit: str, excl: bool
) -> None:
    body = client.get(
        "/api/distribution",
        params={
            "field": field,
            "unit": unit,
            "q": condition_q(ast) or "",
            "limit": 4,
            "facetSelfExclude": str(excl).lower(),
        },
    ).json()
    population = accessions(client, unit, body["populationQ"])
    biosamples = accessions(client, "biosample", body["populationQ"])
    for element in body["elements"][:4]:
        for key, status in (("countExact", "mapped_exact"), ("countSelected", "mapped_selected")):
            want = _closure_count(store_con, unit, population, biosamples, field, element["value"], status)
            assert element[key] == want, (element["value"], key)


def _q_params(ast: Node | None, unit: str, excl: bool, **more: Any) -> dict[str, Any]:
    return {"unit": unit, "q": condition_q(ast) or "", "facetSelfExclude": str(excl).lower(), **more}


def _expected_cell(row: int, col: int, total: int, observed: int) -> dict[str, Any]:
    """The statistics of a cell computed from the formulas of docs/api.md."""
    if total == 0:
        return {"expected": None, "ratio": None, "residual": None, "classification": None}
    expected = row * col / total
    ratio = None if expected == 0 else observed / expected
    denominator = expected * (1 - row / total) * (1 - col / total)
    residual = None if denominator <= 0 else (observed - expected) / math.sqrt(denominator)
    classification = None
    if expected >= 5:
        if observed == 0:
            classification = "gap"
        elif ratio is not None and residual is not None:
            if ratio <= 0.5 and residual <= -2:
                classification = "under"
            elif ratio >= 2 and residual >= 2:
                classification = "over"
    return {"expected": expected, "ratio": ratio, "residual": residual, "classification": classification}


def _same_number(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return a is b
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)


_PAIRS = (
    ("disease", "library_strategy"),
    ("tissue", "drug"),
    ("library_strategy", "organism_id"),
    ("cell_line", "date_published"),
    ("organism_id", "disease"),
)


@settings(max_examples=60)
@given(conditions, st.sampled_from(_PAIRS), st.sampled_from(UNITS), st.booleans(), st.integers(1, 5))
def test_crosstab_cell_statistics_follow_the_formulas_of_the_docs(
    client: TestClient, ast: Node | None, pair: tuple[str, str], unit: str, excl: bool, limit: int
) -> None:
    body = client.get("/api/crosstab", params=_q_params(ast, unit, excl, row=pair[0], col=pair[1], limit=limit)).json()
    rows = {r["value"]: r["count"] for r in body["rows"]}
    cols = {c["value"]: c["count"] for c in body["cols"]}
    for cell in body["cells"]:
        want = _expected_cell(rows[cell["row"]], cols[cell["col"]], body["total"], cell["count"])
        for key in ("expected", "ratio", "residual"):
            assert _same_number(cell[key], want[key]), (cell, key, want)
        # A value that is within rounding of a threshold has no single class.
        near = any(want["ratio"] is not None and abs(want["ratio"] - t) < 1e-9 for t in (0.5, 2.0))
        near = near or any(want["residual"] is not None and abs(want["residual"] - t) < 1e-9 for t in (-2.0, 2.0))
        if not near:
            assert cell["classification"] == want["classification"], (cell, want)


@settings(max_examples=10)
@given(st.sampled_from(UNITS), st.booleans())
def test_crosstab_cell_of_a_row_without_units_has_no_ratio_and_no_residual(
    client: TestClient, unit: str, excl: bool
) -> None:
    body = client.get(
        "/api/crosstab",
        params=_q_params(None, unit, excl, row="disease", col="library_strategy", rowElements="MONDO:9999999"),
    ).json()
    assert body["total"] > 0
    assert [r["count"] for r in body["rows"]] == [0]
    for cell in body["cells"]:
        assert cell["count"] == 0
        assert cell["expected"] == 0
        assert cell["ratio"] is None
        assert cell["residual"] is None
        assert cell["classification"] is None


@settings(max_examples=10)
@given(st.sampled_from(UNITS))
def test_crosstab_cell_of_a_column_that_holds_the_whole_population_has_no_residual(
    client: TestClient, unit: str
) -> None:
    body = client.get(
        "/api/crosstab",
        params={
            "row": "disease",
            "col": "library_strategy",
            "unit": unit,
            "q": "library_strategy:RNA-Seq",
            "colElements": "RNA-Seq",
        },
    ).json()
    assert body["total"] > 0
    assert [c["count"] for c in body["cols"]] == [body["total"]]
    assert body["cells"]
    for cell in body["cells"]:
        assert cell["residual"] is None, cell


@settings(max_examples=20)
@given(conditions, st.booleans())
def test_project_counts_equal_the_counts_of_the_condition_and_the_project(
    client: TestClient, ast: Node | None, excl: bool
) -> None:
    body = client.get(
        "/api/projects", params={"q": condition_q(ast) or "", "facetSelfExclude": str(excl).lower(), "perPage": 4}
    ).json()
    for item in body["items"][:4]:
        q = and_clauses(body["populationQ"], item["clauses"])
        assert item["biosampleCount"] == count(client, q), item["identifier"]
        assert item["experimentCount"] == count(client, q, "sra-experiment"), item["identifier"]


def _has_keyword(node: dict[str, Any]) -> bool:
    return node.get("op") == "free_text" or any(_has_keyword(child) for child in node.get("rules", []))


def _keyword_conjuncts(client: TestClient, q: str | None) -> set[str]:
    """The top-level conjuncts of `q` that have a keyword, as sorted JSON."""
    if q is None:
        return set()
    tree = client.get("/api/dsl/parse", params={"q": q}).json()["ast"]
    tops = tree["rules"] if tree.get("op") == "AND" else [tree]
    return {json.dumps(c, sort_keys=True) for c in tops if _has_keyword(c)}


_MIXED = BoolOp(
    op="OR", children=(FieldClause(field="disease", value_kind="phrase", value="MONDO:0000002"), FreeText("liver"))
)


@settings(max_examples=25)
@given(
    conditions,
    st.lists(
        st.sampled_from([FreeText("run1"), FreeText("liver"), FreeText("breast cancer", True)]), min_size=1, max_size=2
    ),
    st.booleans(),
)
def test_self_exclusion_keeps_every_keyword_conjunct_in_the_population_q(
    client: TestClient, ast: Node | None, keywords: list[FreeText], mixed: bool
) -> None:
    with_keywords = replace_keywords(ast, keywords)
    # A conjunct that mixes a clause on the dimension with a keyword stays too.
    full = from_conjuncts([*conjuncts(with_keywords), _MIXED]) if mixed else with_keywords
    q = condition_q(full) or ""
    wanted = _keyword_conjuncts(client, q)
    assert wanted
    self_exclude = {"q": q, "facetSelfExclude": "true"}
    responses = [
        client.get("/api/distribution", params={**self_exclude, "field": "disease"}).json()["populationQ"],
        client.get("/api/crosstab", params={**self_exclude, "row": "disease", "col": "library_strategy"}).json()[
            "populationQ"
        ],
        client.get("/api/trend", params={**self_exclude, "field": "disease"}).json()["populationQ"],
        client.get("/api/trend", params=self_exclude).json()["totalPopulationQ"],
        client.get("/api/projects", params=self_exclude).json()["populationQ"],
        client.get("/api/terms", params={**self_exclude, "field": "disease"}).json()["populationQ"],
        client.get(
            "/api/terms/children", params={**self_exclude, "field": "disease", "termId": "MONDO:0000001"}
        ).json()["populationQ"],
    ]
    for population_q in responses:
        assert _keyword_conjuncts(client, population_q) == wanted, population_q
