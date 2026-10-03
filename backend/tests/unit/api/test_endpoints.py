from __future__ import annotations

import datetime
from collections.abc import Callable
from typing import Any

import duckdb
import orjson
import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from tests.api_helpers import accessions, count, entry_items, entry_pages
from tests.synthetic import TARGET_ASSAYS, Synthetic


def test_dataset_reports_version_fields_and_totals(client: TestClient) -> None:
    body = client.get("/api/dataset").json()
    assert body["datasetVersion"]["name"] == "synthetic"
    assert len(body["datasetVersion"]["digest"]) == 16
    assert [f["name"] for f in body["fields"]] == ["cell_line", "disease", "tissue", "drug", "chip_antigen"]
    assert body["fields"][1]["ontologies"] == ["MONDO"]
    assert all(body["totals"][key] > 0 for key in ("biosample", "experiment", "bioproject"))
    assert list(body["statuses"]) == ["mapped", "unmapped", "no_value"]
    assert {o["identifier"] for o in body["organisms"]} <= {"9606", "10090"}
    assert all(set(o) == {"identifier", "name", "biosampleCount"} for o in body["organisms"])
    assert "createdAt" in body["version"]
    assert "reference_snapshots" not in body["version"]
    assert "referenceSnapshots" in body["version"]


def test_dataset_counts_equal_the_distributions_of_the_whole_population(client: TestClient) -> None:
    body = client.get("/api/dataset").json()

    def counts(field: str) -> dict[str, int]:
        params = {"field": field, "limit": 200}
        return {e["value"]: e["count"] for e in client.get("/api/distribution", params=params).json()["elements"]}

    assays = counts("library_strategy")
    returned = [(a["name"], a["biosampleCount"]) for a in body["assays"]]
    assert dict(returned) == {a: assays.get(a, 0) for a in body["targetAssays"]}
    assert [n for _, n in returned] == sorted((n for _, n in returned), reverse=True)
    assert {o["identifier"]: o["biosampleCount"] for o in body["organisms"]} == counts("organism_id")
    for field in body["fields"]:
        assert field["mappedBiosampleCount"] == count(client, f"{field['name']}_status:mapped"), field


def test_organism_names_are_the_names_that_most_biosamples_give_everywhere(
    client: TestClient, store_con: duckdb.DuckDBPyConnection
) -> None:
    variants = store_con.execute("SELECT count(*) FROM biosample WHERE organism_name IN ('9606', 'Mouse')").fetchone()
    assert variants is not None
    assert variants[0] > 0
    expected = {"9606": "Homo sapiens", "10090": "Mus musculus"}
    dataset = {o["identifier"]: o["name"] for o in client.get("/api/dataset").json()["organisms"]}
    assert dataset == expected
    elements = client.get("/api/distribution", params={"field": "organism_id"}).json()["elements"]
    assert {e["value"]: e["label"] for e in elements} == expected
    labels = client.get("/api/dsl/parse", params={"q": "organism_id:9606 OR organism_id:10090"}).json()["labels"]
    assert labels == expected


def test_dataset_totals_have_exactly_biosample_experiment_and_bioproject(client: TestClient) -> None:
    totals = client.get("/api/dataset").json()["totals"]
    assert set(totals) == {"biosample", "experiment", "bioproject"}


def test_every_response_carries_the_same_dataset_version(client: TestClient) -> None:
    ref = client.get("/api/dataset").json()["datasetVersion"]
    for path in (
        "/api/distribution?field=disease",
        "/api/entries/biosample",
        "/api/projects",
        "/api/dsl/parse?q=disease_status:mapped",
    ):
        assert client.get(path).json()["datasetVersion"] == ref


def test_parse_returns_ast_and_normalized_q(client: TestClient) -> None:
    body = client.get(
        "/api/dsl/parse",
        params={"q": '(disease:"MONDO:0007254" OR disease:"MONDO:0005061") AND library_strategy:ATAC-seq'},
    ).json()
    assert body["q"] == '(disease:"MONDO:0007254" OR disease:"MONDO:0005061") AND library_strategy:ATAC-seq'
    assert body["ast"]["op"] == "AND"
    assert body["labels"] == {"MONDO:0007254": "breast cancer", "MONDO:0005061": "lung adenocarcinoma"}
    assert body["ast"]["rules"][0] == {
        "op": "OR",
        "rules": [
            {"field": "disease", "op": "eq", "value": "MONDO:0007254"},
            {"field": "disease", "op": "eq", "value": "MONDO:0005061"},
        ],
    }


def test_parse_of_the_returned_q_returns_the_same_condition(client: TestClient) -> None:
    parsed = client.get(
        "/api/dsl/parse", params={"q": "NOT organism_id:9606 AND date_published:[2015-01-01 TO 2020-12-31]"}
    ).json()
    assert client.get("/api/dsl/parse", params={"q": parsed["q"]}).json() == parsed


def test_parse_returns_the_selected_clauses_and_the_keyword_text(client: TestClient) -> None:
    q = (
        '(disease:"MONDO:0007254" OR disease:"MONDO:0005061") AND NOT tissue:"UBERON:1" '
        'AND (cell_line:"CVCL:1" OR tissue:"UBERON:2") AND date_published:[2015-01-01 TO 2020-12-31] '
        'AND breast AND "cell line"'
    )
    body = client.get("/api/dsl/parse", params={"q": q}).json()
    assert body["selected"] == [
        {"field": "disease", "value": "MONDO:0007254"},
        {"field": "disease", "value": "MONDO:0005061"},
        {"field": "date_published", "from": "2015-01-01", "to": "2020-12-31"},
    ]
    assert body["keyword"] == 'breast "cell line"'


def test_select_and_keyword_return_the_selected_clauses_and_the_keyword_text(client: TestClient) -> None:
    clause = {"field": "disease", "value": "MONDO:0007254"}
    selected = client.post("/api/dsl/select", json={"q": None, "clauses": [clause]}).json()
    assert selected["selected"] == [clause]
    assert selected["keyword"] == ""
    typed = client.post("/api/dsl/keyword", json={"q": selected["dsl"], "keyword": 'breast "cell line"'}).json()
    assert typed["selected"] == [clause]
    assert typed["keyword"] == 'breast "cell line"'
    cleared = client.post("/api/dsl/select", json={"q": typed["dsl"], "clauses": [clause]}).json()
    assert cleared["selected"] == []
    assert cleared["keyword"] == 'breast "cell line"'


def test_select_removes_a_clause_that_is_in_a_later_group_of_its_field(client: TestClient) -> None:
    q = 'disease:"MONDO:0007254" AND disease:"MONDO:0005148"'
    body = client.post(
        "/api/dsl/select", json={"q": q, "clauses": [{"field": "disease", "value": "MONDO:0005148"}]}
    ).json()
    assert body["dsl"] == 'disease:"MONDO:0007254"'
    assert body["selected"] == [{"field": "disease", "value": "MONDO:0007254"}]


def test_select_builds_the_documented_condition(client: TestClient) -> None:
    q = None
    for clause in (
        {"field": "disease", "value": "MONDO:A"},
        {"field": "library_strategy", "value": "ATAC-seq"},
        {"field": "disease", "value": "MONDO:B"},
    ):
        q = client.post("/api/dsl/select", json={"q": q, "clauses": [clause]}).json()["dsl"]
    assert q == '(disease:"MONDO:A" OR disease:"MONDO:B") AND library_strategy:ATAC-seq'
    removed = client.post(
        "/api/dsl/select", json={"q": q, "clauses": [{"field": "disease", "value": "MONDO:A"}]}
    ).json()
    assert removed["dsl"] == 'disease:"MONDO:B" AND library_strategy:ATAC-seq'
    year = client.post(
        "/api/dsl/select",
        json={"q": None, "clauses": [{"field": "date_published", "from": "2020-01-01", "to": "2020-12-31"}]},
    ).json()
    assert year["dsl"] == "date_published:[2020-01-01 TO 2020-12-31]"


def test_invalid_conditions_are_problem_documents(client: TestClient) -> None:
    for q, slug in (
        ("--", "invalid-value"),
        ("cancer*", "unexpected-token"),
        ("nope:x", "unknown-field"),
        ("disease:(", "unexpected-token"),
    ):
        response = client.get("/api/entries/biosample", params={"q": q})
        assert response.status_code == 400, q
        assert response.headers["content-type"].startswith("application/problem+json")
        body = response.json()
        assert body["type"] == f"https://ddbj.nig.ac.jp/problems/{slug}"
        assert body["title"] == "Bad Request"
        assert body["status"] == 400
        assert body["instance"] == "/api/entries/biosample"


def test_invalid_select_clause_is_a_problem_document(client: TestClient) -> None:
    response = client.post("/api/dsl/select", json={"clauses": [{"field": "disease", "from": "2020-01-01"}]})
    assert response.status_code == 400
    assert response.json()["type"] == "https://ddbj.nig.ac.jp/problems/invalid-ast"


def test_invalid_query_parameters_are_problem_documents(client: TestClient) -> None:
    response = client.get("/api/entries/biosample", params={"page": 0})
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["type"] == "about:blank"
    assert response.json()["title"] == "Unprocessable Entity"
    invalid = client.get("/api/distribution", params={"field": "title"}).json()
    assert invalid["type"] == "https://ddbj.nig.ac.jp/problems/unknown-field"


def test_distribution_returns_elements_with_clauses_and_the_count_without_a_term(client: TestClient) -> None:
    body = client.get("/api/distribution", params={"field": "disease", "unit": "biosample"}).json()
    assert body["field"] == "disease"
    assert body["populationQ"] is None
    assert body["total"] > 0
    assert 0 < len(body["elements"]) <= 10
    first = body["elements"][0]
    assert first["clauses"] == [{"field": "disease", "value": first["value"]}]
    assert first["count"] >= first["countExact"] + 0
    assert 0 < body["withoutTerm"] < body["total"]
    assert "status" not in body
    assays = client.get("/api/distribution", params={"field": "library_strategy"}).json()
    assert assays["withoutTerm"] is None


def test_distribution_without_term_counts_the_population_of_the_bars(client: TestClient) -> None:
    q = "disease_status:mapped AND library_strategy:RNA-Seq"
    body = client.get("/api/distribution", params={"field": "disease", "q": q, "facetSelfExclude": "true"}).json()
    assert body["populationQ"] == q
    assert body["withoutTerm"] == 0


def test_distribution_self_exclusion_drops_own_conjunct(client: TestClient) -> None:
    q = 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq'
    on = client.get("/api/distribution", params={"field": "disease", "q": q, "facetSelfExclude": "true"}).json()
    off = client.get("/api/distribution", params={"field": "disease", "q": q}).json()
    assert on["facetSelfExclude"] is True
    assert off["facetSelfExclude"] is False
    assert on["populationQ"] == "library_strategy:RNA-Seq"
    assert off["populationQ"] == q
    assert off["withoutTerm"] == 0


def test_redundant_parentheses_do_not_change_the_population(client: TestClient) -> None:
    flat = 'disease:"MONDO:0007254" AND organism_id:9606 AND disease:"MONDO:0005061"'
    nested = 'disease:"MONDO:0007254" AND (organism_id:9606 AND disease:"MONDO:0005061")'
    for path, params in (
        ("/api/distribution", {"field": "disease", "facetSelfExclude": "true"}),
        ("/api/crosstab", {"row": "disease", "col": "library_strategy", "facetSelfExclude": "true"}),
        ("/api/trend", {"field": "disease", "facetSelfExclude": "true"}),
    ):
        a = client.get(path, params={**params, "q": flat}).json()
        b = client.get(path, params={**params, "q": nested}).json()
        assert a["q"] == b["q"] == flat
        assert a["populationQ"] == b["populationQ"] == "organism_id:9606", path
    trend = client.get("/api/trend", params={"q": nested, "facetSelfExclude": "true"}).json()
    assert trend["totalPopulationQ"] == flat
    clause = {"field": "organism_id", "value": "9606"}
    selected = [
        client.post("/api/dsl/select", json={"q": q, "clauses": [clause]}).json()["dsl"] for q in (flat, nested)
    ]
    assert selected[0] == selected[1] == 'disease:"MONDO:0007254" AND disease:"MONDO:0005061"'


def test_distribution_year_elements_carry_range_clauses(client: TestClient) -> None:
    body = client.get("/api/distribution", params={"field": "date_published"}).json()
    element = body["elements"][0]
    assert element["clauses"] == [
        {"field": "date_published", "from": f"{element['value']}-01-01", "to": f"{element['value']}-12-31"}
    ]


def test_crosstab_returns_cells_with_expected_counts(client: TestClient) -> None:
    body = client.get("/api/crosstab", params={"row": "disease", "col": "library_strategy"}).json()
    assert body["rows"]
    assert body["cols"]
    assert len(body["cells"]) == len(body["rows"]) * len(body["cols"])
    cell = body["cells"][0]
    r = next(x for x in body["rows"] if x["value"] == cell["row"])["count"]
    c = next(x for x in body["cols"] if x["value"] == cell["col"])["count"]
    assert cell["expected"] == r * c / body["total"]
    for each in body["cells"]:
        assert each["ratio"] == (None if not each["expected"] else each["count"] / each["expected"])
    assert cell["classification"] in (None, "gap", "under", "over")


def test_trend_returns_points_per_year(client: TestClient) -> None:
    body = client.get("/api/trend", params={"field": "tissue", "unit": "sra-experiment", "limit": 2}).json()
    assert body["years"] == sorted(body["years"])
    assert body["field"] == "tissue"
    assert len(body["series"]) <= 2
    for series in body["series"]:
        assert [p["year"] for p in series["points"]] == body["years"]
        assert series["points"][0]["clauses"][1]["field"] == "date_published"
    assert [p["year"] for p in body["total"]] == body["years"]


def test_trend_without_a_field_counts_the_condition_per_year(client: TestClient) -> None:
    body = client.get("/api/trend").json()
    assert body["field"] is None
    assert body["series"] == []
    assert body["totalPopulationQ"] is None
    assert body["populationQ"] is None
    assert [p["year"] for p in body["total"]] == body["years"]
    assert body["years"] == list(range(body["years"][0], body["years"][-1] + 1))
    point = body["total"][0]
    assert point["clauses"] == [
        {"field": "date_published", "from": f"{point['year']}-01-01", "to": f"{point['year']}-12-31"}
    ]
    dated = client.get("/api/entries/biosample", params={"q": "date_published:[1000-01-01 TO 2999-12-31]"}).json()
    assert sum(p["count"] for p in body["total"]) == dated["pagination"]["total"]


def test_trend_returns_every_year_between_the_first_and_the_last_with_zero_counts(
    client: TestClient, store_con: duckdb.DuckDBPyConnection
) -> None:
    rows = store_con.execute(
        "SELECT biosample, year(date_published) FROM population WHERE date_published IS NOT NULL ORDER BY 2, 1"
    ).fetchall()
    (first, first_year), (last, last_year) = rows[0], rows[-1]
    assert last_year - first_year >= 2
    q = f"{first} OR {last}"
    years = list(range(first_year, last_year + 1))
    body = client.get("/api/trend", params={"q": q}).json()
    assert body["years"] == years
    counts = {p["year"]: p["count"] for p in body["total"]}
    assert counts[first_year] >= 1
    assert counts[last_year] >= 1
    assert all(counts[y] == 0 for y in years[1:-1])
    split = client.get("/api/trend", params={"q": q, "field": "tissue"}).json()
    assert split["years"] == years
    assert all([p["year"] for p in series["points"]] == years for series in split["series"])


def test_trend_populations_exclude_the_year_and_the_series_dimension(client: TestClient) -> None:
    q = 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq AND date_published:[2015-01-01 TO 2016-12-31]'
    on = client.get("/api/trend", params={"q": q, "field": "disease", "facetSelfExclude": "true"}).json()
    assert on["totalPopulationQ"] == 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq'
    assert on["populationQ"] == "library_strategy:RNA-Seq"
    assert "MONDO:0007254" in [s["value"] for s in on["series"]]
    off = client.get("/api/trend", params={"q": q, "field": "disease"}).json()
    assert off["totalPopulationQ"] == off["populationQ"] == q
    assert all(2015 <= y <= 2016 for y in off["years"])


def test_trend_reversed_year_range_returns_no_years_and_the_first_and_last_year(client: TestClient) -> None:
    full = client.get("/api/trend", params={"field": "disease"}).json()
    first, last = full["years"][0], full["years"][-1]
    response = client.get("/api/trend", params={"field": "disease", "yearFrom": last, "yearTo": first})
    assert response.status_code == 200
    body = response.json()
    assert body["years"] == []
    assert body["total"] == []
    assert body["series"]
    assert all(s["points"] == [] for s in body["series"])
    assert (body["firstYear"], body["lastYear"]) == (first, last)


def test_trend_single_year_range_returns_that_year(client: TestClient) -> None:
    full = client.get("/api/trend").json()
    year = full["years"][1]
    body = client.get("/api/trend", params={"yearFrom": year, "yearTo": year}).json()
    assert body["years"] == [year]
    assert body["total"] == [full["total"][1]]


def test_trend_without_matches_has_no_first_and_last_year(client: TestClient) -> None:
    body = client.get("/api/trend", params={"q": "SAMN99999999", "field": "disease"}).json()
    assert body["years"] == []
    assert body["firstYear"] is None
    assert body["lastYear"] is None


def test_trend_rejects_the_year_as_its_dimension(client: TestClient) -> None:
    response = client.get("/api/trend", params={"field": "date_published"})
    assert response.status_code == 400
    assert response.json()["type"] == "https://ddbj.nig.ac.jp/problems/invalid-dimension"


def test_crosstab_rejects_the_same_dimension_on_both_axes(client: TestClient) -> None:
    response = client.get("/api/crosstab", params={"row": "disease", "col": "disease"})
    assert response.status_code == 400
    assert response.json()["type"] == "https://ddbj.nig.ac.jp/problems/invalid-dimension"


@pytest.mark.parametrize("value", ["mapped_exact", "mapped_selected", "unmapped_no_candidate", "unmapped_rejected"])
def test_entries_condition_on_a_detailed_status_is_rejected_with_the_accepted_groups(
    client: TestClient, value: str
) -> None:
    response = client.get("/api/entries/biosample", params={"q": f"disease_status:{value}"})
    assert response.status_code == 400
    body = response.json()
    assert body["type"] == "https://ddbj.nig.ac.jp/problems/invalid-value"
    assert all(group in body["detail"] for group in ("mapped", "unmapped", "no_value"))


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/api/distribution", {"field": "disease_status"}),
        ("/api/crosstab", {"row": "disease", "col": "disease_status"}),
        ("/api/crosstab", {"row": "tissue_status", "col": "disease"}),
        ("/api/trend", {"field": "disease_status"}),
        ("/api/terms", {"field": "disease_status"}),
    ],
)
def test_a_status_field_is_not_an_aggregation_dimension(client: TestClient, path: str, params: dict[str, str]) -> None:
    response = client.get(path, params=params)
    assert response.status_code == 400
    assert response.json()["type"] == "https://ddbj.nig.ac.jp/problems/invalid-dimension"


def test_select_narrow_builds_the_documented_condition(client: TestClient) -> None:
    table = client.get(
        "/api/crosstab",
        params={
            "row": "cell_line",
            "col": "library_strategy",
            "q": "library_strategy:ChIP-Seq",
            "facetSelfExclude": "true",
        },
    ).json()
    assert table["populationQ"] is None
    cell = [{"field": "cell_line", "value": "CVCL:A"}, {"field": "library_strategy", "value": "RNA-Seq"}]
    narrowed = client.post(
        "/api/dsl/select", json={"q": table["populationQ"], "clauses": cell, "mode": "narrow"}
    ).json()
    assert narrowed["dsl"] == 'cell_line:"CVCL:A" AND library_strategy:RNA-Seq'
    again = client.post("/api/dsl/select", json={"q": narrowed["dsl"], "clauses": cell, "mode": "narrow"}).json()
    assert again["dsl"] == narrowed["dsl"]
    kept = client.post(
        "/api/dsl/select",
        json={
            "q": '(cell_line:"CVCL:A" OR cell_line:"CVCL:B") AND organism_id:9606',
            "clauses": cell[:1],
            "mode": "narrow",
        },
    ).json()
    assert kept["dsl"] == '(cell_line:"CVCL:A" OR cell_line:"CVCL:B") AND organism_id:9606 AND cell_line:"CVCL:A"'
    invalid = client.post("/api/dsl/select", json={"q": None, "clauses": cell, "mode": "other"})
    assert invalid.status_code == 422
    assert invalid.json()["type"] == "about:blank"


def _two_disease_terms(client: TestClient) -> tuple[str, str]:
    elements = client.get("/api/distribution", params={"field": "disease", "limit": 50}).json()["elements"]
    top = client.get("/api/distribution", params={"field": "disease", "limit": 1}).json()["elements"][0]["value"]
    other = next(e["value"] for e in reversed(elements) if e["value"] != top)
    return top, other


def test_default_elements_include_the_terms_the_condition_names(client: TestClient) -> None:
    top, other = _two_disease_terms(client)
    plain = client.get("/api/distribution", params={"field": "disease", "limit": 1}).json()
    assert [e["value"] for e in plain["elements"]] == [top]
    named = client.get(
        "/api/distribution",
        params={"field": "disease", "limit": 1, "q": f'disease:"{other}"', "facetSelfExclude": "true"},
    ).json()
    assert {e["value"] for e in named["elements"]} == {top, other}
    counts = [e["count"] for e in named["elements"]]
    assert counts == sorted(counts, reverse=True)
    table = client.get(
        "/api/crosstab",
        params={
            "row": "disease",
            "col": "library_strategy",
            "limit": 1,
            "q": f'disease:"{other}"',
            "facetSelfExclude": "true",
        },
    ).json()
    assert {r["value"] for r in table["rows"]} == {top, other}
    trend = client.get(
        "/api/trend", params={"field": "disease", "limit": 1, "q": f'disease:"{other}"', "facetSelfExclude": "true"}
    ).json()
    assert {s["value"] for s in trend["series"]} == {top, other}


def test_default_elements_ignore_negated_and_explicitly_named_requests(client: TestClient) -> None:
    top, other = _two_disease_terms(client)
    negated = client.get(
        "/api/distribution", params={"field": "disease", "limit": 1, "q": f'NOT disease:"{other}"'}
    ).json()
    assert other not in [e["value"] for e in negated["elements"]]
    explicit = client.get(
        "/api/distribution", params={"field": "disease", "elements": top, "q": f'disease:"{other}"'}
    ).json()
    assert [e["value"] for e in explicit["elements"]] == [top]


def test_default_elements_include_an_unannotated_term_with_a_zero_count(client: TestClient) -> None:
    body = client.get("/api/distribution", params={"field": "disease", "q": 'disease:"MONDO:9999999"'}).json()
    named = next(e for e in body["elements"] if e["value"] == "MONDO:9999999")
    assert named["count"] == 0
    assert named["label"] == "MONDO:9999999"


def test_projects_default_request_lists_bioprojects_with_their_clauses(client: TestClient) -> None:
    body = client.get("/api/projects", params={"perPage": 5}).json()
    assert body["pagination"]["total"] > 0
    assert body["pagination"]["perPage"] == 5
    assert len(body["items"]) <= 5
    assert body["sort"] == "biosampleCount:desc"
    project = body["items"][0]
    assert project["clauses"] == [{"field": "bioproject", "value": project["identifier"]}]


PROJECT_SORT_KEYS: dict[str, Callable[[dict[str, Any]], tuple[Any, ...]]] = {
    "biosampleCount:desc": lambda p: (-p["biosampleCount"], -p["experimentCount"], p["identifier"]),
    "biosampleCount:asc": lambda p: (p["biosampleCount"], p["experimentCount"], p["identifier"]),
    "experimentCount:desc": lambda p: (-p["experimentCount"], -p["biosampleCount"], p["identifier"]),
    "experimentCount:asc": lambda p: (p["experimentCount"], p["biosampleCount"], p["identifier"]),
}


@pytest.mark.parametrize("sort", list(PROJECT_SORT_KEYS))
def test_projects_sort_each_key_and_direction_orders_all_items(client: TestClient, sort: str) -> None:
    body = client.get("/api/projects", params={"sort": sort, "perPage": 100}).json()
    assert body["sort"] == sort
    items = body["items"]
    assert len(items) == body["pagination"]["total"]
    assert items == sorted(items, key=PROJECT_SORT_KEYS[sort])


@pytest.mark.parametrize("sort", ["biosampleCount:asc", "experimentCount:desc"])
def test_projects_sort_pages_are_slices_of_one_order(client: TestClient, sort: str) -> None:
    whole = client.get("/api/projects", params={"sort": sort, "perPage": 6}).json()["items"]
    first = client.get("/api/projects", params={"sort": sort, "perPage": 3, "page": 1}).json()["items"]
    second = client.get("/api/projects", params={"sort": sort, "perPage": 3, "page": 2}).json()["items"]
    assert first + second == whole


@pytest.mark.parametrize(
    "sort", ["biosample", "biosampleCount", "biosampleCount:up", "title:asc", "identifier:asc", ""]
)
def test_projects_sort_unknown_value_is_rejected(client: TestClient, sort: str) -> None:
    assert client.get("/api/projects", params={"sort": sort}).status_code == 422


def test_entries_pages_are_disjoint_and_cover_the_total(client: TestClient) -> None:
    first = client.get("/api/entries/biosample", params={"perPage": 7, "page": 1}).json()
    second = client.get("/api/entries/biosample", params={"perPage": 7, "page": 2}).json()
    assert len(first["items"]) == 7
    assert {r["identifier"] for r in first["items"]}.isdisjoint({r["identifier"] for r in second["items"]})


@pytest.mark.parametrize("kind", ["sra-experiment", "sra-run", "bioproject"])
def test_entries_of_a_type_other_than_biosample_are_not_found(client: TestClient, kind: str) -> None:
    assert client.get(f"/api/entries/{kind}").status_code == 404
    assert client.get(f"/api/export/entries/{kind}").status_code == 404


@pytest.mark.parametrize("q", [None, "library_strategy:RNA-Seq", "library_strategy:ChIP-Seq"])
def test_entries_list_every_matching_experiment_in_the_item_of_its_biosample(client: TestClient, q: str | None) -> None:
    listed = [e for item in entry_items(client, q) for e in item["experiments"]]
    assert sorted(listed) == accessions(client, "sra-experiment", q)


def test_entries_rows_carry_annotations_for_every_field(client: TestClient) -> None:
    row = client.get("/api/entries/biosample", params={"perPage": 1}).json()["items"][0]
    assert row["type"] == "biosample"
    assert row["identifier"].startswith("SAM")
    assert list(row["annotations"]) == ["cell_line", "disease", "tissue", "drug", "chip_antigen"]
    assert all(a["status"] for values in row["annotations"].values() for a in values)
    assert row["organism"] is None or set(row["organism"]) == {"identifier", "name"}
    assert all(
        set(a) == {"value", "status", "termId", "label"} for values in row["annotations"].values() for a in values
    )


def test_entry_returns_attributes_annotations_and_evidence(client: TestClient, synthetic: Synthetic) -> None:
    accession = synthetic.accessions[0]
    body = client.get(f"/api/entries/biosample/{accession}").json()
    assert body["identifier"] == accession
    assert body["type"] == "biosample"
    assert "accession" not in body
    assert body["metadata"][0] == {
        "kind": "description",
        "name": "Title",
        "value": body["title"],
        "harmonizedName": None,
    }
    assert next(i["name"] for i in body["metadata"] if i["kind"] == "attribute") == "sample_name"
    fields = list(dict.fromkeys(a["field"] for a in body["annotations"]))
    assert fields == ["cell_line", "disease", "tissue", "drug", "chip_antigen"]
    assert any(annotation["evidence"] for annotation in body["annotations"])
    for annotation in body["annotations"]:
        for evidence in annotation["evidence"]:
            item = body["metadata"][evidence["metadataIndex"]]
            assert item["name"] == evidence["name"]
            text = item["name"] if evidence["inName"] else item["value"]
            assert 0 <= evidence["start"] < evidence["end"] <= len(text)
            if evidence["strategy"] == "exact":
                assert text[evidence["start"] : evidence["end"]] == annotation["value"].strip()
    assert {e["accession"] for e in body["experiments"]} == {srx for srx, _ in synthetic.truth.experiments[accession]}
    missing = client.get("/api/entries/biosample/SAMN_NONE")
    assert missing.status_code == 404
    assert missing.json()["type"] == "about:blank"
    assert missing.json()["title"] == "Not Found"


def test_terms_search_matches_label_synonym_and_id(client: TestClient) -> None:
    for query in ("breast", "mammary", "MONDO:0007254"):
        hits = client.get("/api/terms", params={"field": "disease", "query": query}).json()["terms"]
        assert any(h["termId"] == "MONDO:0007254" for h in hits), query
    hit = next(
        h
        for h in client.get("/api/terms", params={"field": "disease", "query": "breast carcinoma"}).json()["terms"]
        if h["termId"] == "MONDO:0004989"
    )
    assert hit["path"][-1] == "breast cancer"
    assert hit["clauses"] == [{"field": "disease", "value": "MONDO:0004989"}]
    assert client.get("/api/terms", params={"field": "title", "query": "x"}).status_code == 400


def test_terms_search_without_a_field_searches_every_annotation_field(client: TestClient) -> None:
    fields = {f["name"] for f in client.get("/api/dataset").json()["fields"]}
    body = client.get("/api/terms", params={"query": "breast"}).json()
    assert body["field"] is None
    assert body["populationQ"] is None
    assert ("disease", "MONDO:0007254") in {(h["field"], h["termId"]) for h in body["terms"]}
    assert all(
        h["field"] in fields and h["clauses"] == [{"field": h["field"], "value": h["termId"]}] for h in body["terms"]
    )
    by_synonym = client.get("/api/terms", params={"query": "K562"}).json()["terms"]
    assert [(h["field"], h["termId"]) for h in by_synonym] == [("cell_line", "CVCL:0004")]
    by_id = client.get("/api/terms", params={"query": "ncbigene:10664"}).json()["terms"]
    assert [(h["field"], h["label"]) for h in by_id] == [("chip_antigen", "CTCF")]


def test_terms_search_without_a_query_lists_terms_of_several_fields_within_the_limit(client: TestClient) -> None:
    body = client.get("/api/terms", params={"limit": 8}).json()
    assert len(body["terms"]) == 8
    assert len({h["field"] for h in body["terms"]}) > 1
    assert len({(h["field"], h["termId"]) for h in body["terms"]}) == 8
    assert client.get("/api/terms", params={"query": "no such term text"}).json()["terms"] == []


def test_terms_search_treats_like_wildcards_in_the_query_as_text(client: TestClient) -> None:
    assert client.get("/api/terms", params={"query": "%"}).json()["terms"] == []
    assert client.get("/api/terms", params={"query": "_"}).json()["terms"] == []


def test_terms_search_counts_each_hit_without_the_conjuncts_on_its_own_field(client: TestClient) -> None:
    q = 'disease:"MONDO:0005061" AND library_strategy:RNA-Seq'
    hit = next(
        h
        for h in client.get("/api/terms", params={"query": "breast cancer", "q": q, "facetSelfExclude": "true"}).json()[
            "terms"
        ]
        if (h["field"], h["termId"]) == ("disease", "MONDO:0007254")
    )
    assert hit["count"] == count(client, 'library_strategy:RNA-Seq AND disease:"MONDO:0007254"')


def test_terms_children_lists_annotated_children(client: TestClient) -> None:
    body = client.get("/api/terms/children", params={"field": "disease", "termId": "MONDO:0004992"}).json()
    ids = {c["value"] for c in body["children"]}
    assert ids <= {"MONDO:0007254", "MONDO:0005061"}
    assert all(c["count"] > 0 for c in body["children"])


def test_export_accessions_lists_one_per_line(client: TestClient) -> None:
    text = client.get("/api/export/accessions/biosample").text
    lines = text.splitlines()
    assert lines[0].startswith("# bsllmner-viewer biosample accessions")
    total = count(client, None)
    assert len(lines) - 1 == total
    assert len(set(lines[1:])) == total
    runs = accessions(client, "sra-run")
    assert all(r.startswith("SRR") for r in runs)
    experiments = accessions(client, "sra-experiment")
    by_experiment = client.get("/api/distribution", params={"field": "library_strategy", "unit": "sra-experiment"})
    assert len(experiments) == by_experiment.json()["total"]


def test_export_accessions_with_an_unknown_type_is_not_found(client: TestClient) -> None:
    for kind in ("experiment", "run", "nope"):
        response = client.get(f"/api/export/accessions/{kind}")
        assert response.status_code == 404, kind
        assert response.json()["type"] == "about:blank"


def test_export_entries_tsv_and_ndjson(client: TestClient) -> None:
    q = "library_strategy:RNA-Seq"
    tsv_response = client.get("/api/export/entries/biosample", params={"format": "tsv", "q": q})
    assert tsv_response.headers["content-type"].startswith("text/tab-separated-values")
    tsv = tsv_response.text.splitlines()
    total = count(client, q)
    assert tsv[0].split("\t")[:3] == ["identifier", "type", "experiments"]
    assert "libraryStrategy" in tsv[0].split("\t")
    assert len(tsv) - 1 == total
    assert {len(line.split("\t")) for line in tsv} == {len(tsv[0].split("\t"))}
    response = client.get("/api/export/entries/biosample", params={"format": "ndjson", "q": q})
    assert response.headers["content-type"].startswith("application/x-ndjson")
    lines = [orjson.loads(line) for line in response.text.splitlines()]
    assert len(lines) == total
    listed = client.get("/api/entries/biosample", params={"q": q, "perPage": 100}).json()["items"]
    assert lines[: len(listed)] == listed


def test_export_entries_rejects_the_former_json_format(client: TestClient) -> None:
    assert client.get("/api/export/entries/biosample", params={"format": "json"}).status_code == 422


def test_entry_detail_has_date_published_and_neither_date_created_nor_date_modified(
    client: TestClient, store_con: duckdb.DuckDBPyConnection
) -> None:
    rows = store_con.execute("SELECT accession, date_published FROM biosample ORDER BY accession").fetchall()
    assert any(d is None for _, d in rows)
    for accession, published in (rows[0], next(r for r in rows if r[1] is None), next(r for r in rows if r[1])):
        body = client.get(f"/api/entries/biosample/{accession}").json()
        assert body["datePublished"] == (published.isoformat() if published else None)
        assert "dateCreated" not in body
        assert "dateModified" not in body


def test_entry_list_items_have_date_published_and_no_date_created(client: TestClient) -> None:
    items = client.get("/api/entries/biosample", params={"perPage": "50"}).json()["items"]
    assert items
    assert all("datePublished" in item and "dateCreated" not in item for item in items)


@pytest.mark.parametrize("path", ["/api/entries/biosample", "/api/dsl/parse"])
def test_query_with_date_created_is_rejected_as_an_unknown_field(client: TestClient, path: str) -> None:
    response = client.get(path, params={"q": "date_created:[2015-01-01 TO 2020-12-31]"})
    assert response.status_code == 400
    assert "date_created" in response.text


@given(
    low=st.dates(datetime.date(2009, 1, 1), datetime.date(2023, 12, 31)),
    span=st.integers(0, 4000),
)
@settings(max_examples=25, suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_date_published_range_selects_exactly_the_biosamples_published_in_the_range(
    client: TestClient, store_con: duckdb.DuckDBPyConnection, low: datetime.date, span: int
) -> None:
    high = low + datetime.timedelta(days=span)
    q = f"date_published:[{low.isoformat()} TO {high.isoformat()}]"
    expected = {
        str(a)
        for (a,) in store_con.execute(
            "SELECT b.accession FROM biosample b WHERE b.date_published BETWEEN ? AND ? "
            "AND b.accession IN (SELECT biosample FROM population)",
            [low, high],
        ).fetchall()
    }
    assert {item["identifier"] for body in entry_pages(client, q) for item in body["items"]} == expected


def test_entry_returns_no_omitted_attribute_and_its_evidence_points_into_the_returned_attributes(
    client: TestClient, synthetic: Synthetic
) -> None:
    disease_evidence = 0
    checked = 0
    for accession in synthetic.accessions[:20]:
        body = client.get(f"/api/entries/biosample/{accession}").json()
        assert "GEO Accession" not in {i["name"] for i in body["metadata"]}
        for annotation in body["annotations"]:
            for evidence in annotation["evidence"]:
                item = body["metadata"][evidence["metadataIndex"]]
                assert item["name"] == evidence["name"]
                assert evidence["end"] <= len(item["name"] if evidence["inName"] else item["value"])
                assert not evidence["inName"] or item["kind"] == "attribute"
                checked += 1
                disease_evidence += item["name"] == "study disease"
    assert checked > 0
    assert disease_evidence > 0


def test_keyword_does_not_match_the_value_of_an_omitted_attribute(client: TestClient, synthetic: Synthetic) -> None:
    accession = synthetic.accessions[0]
    assert count(client, f"GSM{accession[4:]}") == 0


def test_entry_returns_every_stored_piece_of_evidence_of_each_field(
    client: TestClient, store_con: duckdb.DuckDBPyConnection
) -> None:
    stored: dict[str, dict[str, int]] = {}
    for biosample, field, n_evidence in store_con.execute(
        "SELECT biosample, field, count(*) FROM evidence GROUP BY biosample, field"
    ).fetchall():
        stored.setdefault(str(biosample), {})[str(field)] = int(n_evidence)
    checked = 0
    for accession in sorted(stored)[:40]:
        body = client.get(f"/api/entries/biosample/{accession}").json()
        returned: dict[str, int] = {}
        for annotation in body["annotations"]:
            if annotation["evidence"]:
                returned[annotation["field"]] = returned.get(annotation["field"], 0) + len(annotation["evidence"])
        assert returned == stored[accession]
        checked += sum(returned.values())
    assert checked > 0


def test_entry_leaves_out_a_filter_key_attribute_only_where_no_evidence_of_the_biosample_points_to_it(
    client: TestClient, store_con: duckdb.DuckDBPyConnection
) -> None:
    rows = store_con.execute(
        "SELECT accession, attributes FROM biosample WHERE attributes::VARCHAR LIKE '%Submitter Id%' ORDER BY accession"
    ).fetchall()
    kept = left_out = 0
    for accession, raw in rows[:40]:
        stored = [a["name"] for a in orjson.loads(str(raw))]
        body = client.get(f"/api/entries/biosample/{accession}").json()
        names = [i["name"] for i in body["metadata"] if i["kind"] == "attribute"]
        assert "sample_name" in names
        evidenced = {e["name"] for an in body["annotations"] for e in an["evidence"]}
        if "Submitter Id" in names:
            assert "Submitter Id" in evidenced
            kept += 1
        else:
            assert "Submitter Id" in stored
            left_out += 1
        assert names == [n for n in stored if n in names]
    assert kept > 0
    assert left_out > 0


def test_term_returns_its_label_synonyms_parents_ontology_and_page(client: TestClient) -> None:
    body = client.get("/api/terms/MONDO:0007254").json()
    assert body["termId"] == "MONDO:0007254"
    assert body["label"] == "breast cancer"
    assert body["synonyms"] == ["mammary cancer"]
    assert body["parents"] == [
        {"termId": "MONDO:0002657", "label": "breast disorder"},
        {"termId": "MONDO:0004992", "label": "cancer"},
    ]
    assert body["ontology"] == {"prefix": "MONDO", "name": "MONDO"}
    assert body["url"] == "https://www.ebi.ac.uk/ols4/ontologies/mondo/classes?obo_id=MONDO:0007254"


def test_term_that_the_dataset_does_not_have_is_not_found(client: TestClient) -> None:
    response = client.get("/api/terms/MONDO:9999999")
    assert response.status_code == 404
    assert response.json()["type"] == "about:blank"


def test_term_children_route_is_not_taken_for_a_term(client: TestClient) -> None:
    response = client.get("/api/terms/children", params={"field": "disease", "termId": "MONDO:0004992"})
    assert response.status_code == 200
    assert "children" in response.json()


def test_entry_annotation_with_a_term_has_the_clause_that_selects_the_biosample(
    client: TestClient, synthetic: Synthetic
) -> None:
    checked = 0
    for accession in synthetic.accessions[:20]:
        body = client.get(f"/api/entries/biosample/{accession}").json()
        in_population = any(e["inPopulation"] for e in body["experiments"])
        for annotation in body["annotations"]:
            if annotation["termId"] is None:
                assert annotation["clauses"] == []
                continue
            assert annotation["clauses"] == [{"field": annotation["field"], "value": annotation["termId"]}]
            q = client.post("/api/dsl/select", json={"q": None, "clauses": annotation["clauses"]}).json()["dsl"]
            assert count(client, f"{q} AND {accession}") == (1 if in_population else 0)
            checked += 1
    assert checked > 0


def test_entry_metadata_has_the_description_then_the_record_items_with_evidence_then_the_attributes(
    client: TestClient, store_con: duckdb.DuckDBPyConnection
) -> None:
    rows = store_con.execute(
        "SELECT accession, title, description, record FROM biosample ORDER BY accession LIMIT 60"
    ).fetchall()
    with_record = with_list = 0
    for accession, title, description, record in rows:
        body = client.get(f"/api/entries/biosample/{accession}").json()
        items = body["metadata"]
        kinds = [i["kind"] for i in items]
        order = {"description": 0, "record": 1, "attribute": 2}
        assert kinds == sorted(kinds, key=order.__getitem__)
        described = [(i["name"], i["value"]) for i in items if i["kind"] == "description"]
        expected = ([("Title", title)] if title else []) + [
            (d["name"], d["value"]) for d in orjson.loads(str(description))
        ]
        assert described == expected
        with_list += sum(1 for name, _ in described if name == "Description") > 1
        evidenced = {e["metadataIndex"] for an in body["annotations"] for e in an["evidence"]}
        records = [(at, i) for at, i in enumerate(items) if i["kind"] == "record"]
        assert all(at in evidenced for at, _ in records)
        assert len(records) == len(orjson.loads(str(record)))
        assert all(i["name"] != "Owner.Contacts" and i["harmonizedName"] is None for _, i in records)
        with_record += bool(records)
    assert with_record > 0
    assert with_list > 0


def test_entry_names_record_items_by_short_names_of_their_paths(client: TestClient) -> None:
    from bsllmner_viewer.api.record_names import record_name

    assert record_name("Owner.Name") == "Owner"
    assert record_name("Status.when") == "Status"
    assert record_name("Links.Link.label") == "Link"
    assert record_name("Ids.Id.namespace") == "ID"
    assert record_name("Description.Organism.taxonomy_id") == "Organism"
    assert record_name("publication_date") == "Publication date"
    assert record_name("accession") == "Accession"
    assert record_name("Unknown.Path") == "Unknown.Path"
    assert record_name("Ownership") == "Ownership"


def test_keyword_matches_a_description_paragraph(client: TestClient, store_con: duckdb.DuckDBPyConnection) -> None:
    accession, description = store_con.execute(
        "SELECT accession, description FROM biosample "
        "WHERE description::VARCHAR LIKE '%first paragraph of%' "
        "AND accession IN (SELECT biosample FROM population) ORDER BY accession LIMIT 1"
    ).fetchone()  # type: ignore[misc]
    assert "first paragraph of" in str(description)
    found = client.get("/api/entries/biosample", params={"q": f'"first paragraph of {accession}"'}).json()
    assert [i["identifier"] for i in found["items"]] == [accession]


def test_dataset_names_every_prefix_of_its_terms_as_the_term_endpoint_does(client: TestClient) -> None:
    ontologies = client.get("/api/dataset").json()["ontologies"]
    names = {o["prefix"]: o["name"] for o in ontologies}
    assert len(names) == len(ontologies)
    assert names["CVCL"] == "Cellosaurus"
    assert names["MONDO"] == "MONDO"
    for term_id in ("CVCL:0004", "MONDO:0007254", "NCBIGene:2146", "CHEBI:28748", "UBERON:0002107"):
        ontology = client.get(f"/api/terms/{term_id}").json()["ontology"]
        assert names[ontology["prefix"]] == ontology["name"]


def test_entries_condition_on_an_unknown_assay_is_rejected_with_the_dataset_assays(client: TestClient) -> None:
    response = client.get("/api/entries/biosample", params={"q": "library_strategy:rna-seq"})
    assert response.status_code == 400
    body = response.json()
    assert body["type"] == "https://ddbj.nig.ac.jp/problems/invalid-value"
    assert all(assay in body["detail"] for assay in TARGET_ASSAYS)


def test_entries_condition_on_a_term_that_is_not_a_prefixed_id_points_to_the_term_search(client: TestClient) -> None:
    response = client.get("/api/entries/biosample", params={"q": "tissue:brain"})
    assert response.status_code == 400
    assert response.json()["type"] == "https://ddbj.nig.ac.jp/problems/invalid-value"
    assert "GET /api/terms" in response.json()["detail"]


def test_entries_condition_on_a_well_formed_unknown_term_id_matches_nothing(client: TestClient) -> None:
    assert count(client, 'tissue:"UBERON:9999999"') == 0
    assert count(client, "organism_id:9999999") == 0
    assert count(client, "nonexistentkeyword") == 0


@pytest.mark.parametrize("path", ["/api/entries/{}", "/api/export/entries/{}"])
def test_entry_type_not_found_lists_the_accepted_type(client: TestClient, path: str) -> None:
    response = client.get(path.format("sra-run"))
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert "'sra-run'" in detail
    assert "biosample" in detail


def test_accession_type_not_found_lists_the_accepted_types(client: TestClient) -> None:
    detail = client.get("/api/export/accessions/run").json()["detail"]
    for accepted in ("biosample", "sra-experiment", "sra-run", "bioproject"):
        assert accepted in detail


@pytest.mark.parametrize("accession", ["SRR11745799", "PRJNA1", "brain", "SAMN"])
def test_biosample_not_found_for_another_accession_points_to_the_keyword_search(
    client: TestClient, accession: str
) -> None:
    response = client.get(f"/api/entries/biosample/{accession}")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert accession in detail
    assert "GET /api/entries/biosample" in detail
    assert "keyword" in detail


def test_biosample_not_found_for_a_lower_case_biosample_accession_points_to_the_keyword_search(
    client: TestClient,
) -> None:
    detail = client.get("/api/entries/biosample/samn99999999").json()["detail"]
    assert "GET /api/entries/biosample" in detail
    assert "keyword" in detail


def test_biosample_not_found_for_a_biosample_accession_does_not_point_to_the_keyword_search(
    client: TestClient,
) -> None:
    detail = client.get("/api/entries/biosample/SAMN99999999").json()["detail"]
    assert "SAMN99999999" in detail
    assert "keyword" not in detail


@pytest.mark.parametrize("field", ["tissue_status", "library_strategy", "organism_id", "date_published", "bioproject"])
@pytest.mark.parametrize("path", ["/api/terms", "/api/terms/children"])
def test_term_endpoints_reject_a_field_that_is_not_an_annotation_field_with_the_annotation_fields(
    client: TestClient, path: str, field: str
) -> None:
    params = {"field": field, "termId": "UBERON:1"} if path.endswith("children") else {"field": field}
    response = client.get(path, params=params)
    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    assert "annotation fields are" in detail
    assert "library_strategy" not in detail.split("annotation fields are")[1]
