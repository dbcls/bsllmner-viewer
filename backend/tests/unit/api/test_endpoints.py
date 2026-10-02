from __future__ import annotations

from collections.abc import Callable
from typing import Any

import orjson
import pytest
from fastapi.testclient import TestClient

from tests.synthetic import Synthetic


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


def test_serialize_accepts_a_parse_result(client: TestClient) -> None:
    parsed = client.get(
        "/api/dsl/parse", params={"q": "date_created:[2015-01-01 TO 2020-12-31] AND NOT organism_id:9606"}
    ).json()
    body = client.post("/api/dsl/serialize", json={"ast": parsed["ast"]}).json()
    assert body["dsl"] == parsed["q"]
    assert "q" not in body
    assert body["ast"] == parsed["ast"]


def test_select_builds_the_documented_condition(client: TestClient) -> None:
    q = None
    for clause in (
        {"field": "disease", "value": "A"},
        {"field": "library_strategy", "value": "ATAC-seq"},
        {"field": "disease", "value": "B"},
    ):
        q = client.post("/api/dsl/select", json={"q": q, "clauses": [clause]}).json()["dsl"]
    assert q == "(disease:A OR disease:B) AND library_strategy:ATAC-seq"
    removed = client.post("/api/dsl/select", json={"q": q, "clauses": [{"field": "disease", "value": "A"}]}).json()
    assert removed["dsl"] == "disease:B AND library_strategy:ATAC-seq"
    year = client.post(
        "/api/dsl/select",
        json={"q": None, "clauses": [{"field": "date_created", "from": "2020-01-01", "to": "2020-12-31"}]},
    ).json()
    assert year["dsl"] == "date_created:[2020-01-01 TO 2020-12-31]"


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


def test_invalid_ast_is_a_problem_document(client: TestClient) -> None:
    response = client.post("/api/dsl/serialize", json={"ast": {"op": "XOR"}})
    assert response.status_code == 400
    assert response.json()["type"] == "https://ddbj.nig.ac.jp/problems/invalid-ast"


def test_invalid_query_parameters_are_problem_documents(client: TestClient) -> None:
    response = client.get("/api/entries/biosample", params={"page": 0})
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["type"] == "about:blank"
    assert response.json()["title"] == "Unprocessable Entity"
    invalid = client.get("/api/distribution", params={"field": "title"}).json()
    assert invalid["type"] == "https://ddbj.nig.ac.jp/problems/invalid-dimension"


def test_distribution_returns_elements_with_clauses_and_status(client: TestClient) -> None:
    body = client.get("/api/distribution", params={"field": "disease", "unit": "biosample"}).json()
    assert body["field"] == "disease"
    assert body["populationQ"] is None
    assert body["total"] > 0
    assert 0 < len(body["elements"]) <= 10
    first = body["elements"][0]
    assert first["clauses"] == [{"field": "disease", "value": first["value"]}]
    assert first["count"] >= first["countExact"] + 0
    assert {s["value"] for s in body["status"]} == {"mapped", "unmapped", "no_value"}
    expanded = client.get("/api/distribution", params={"field": "disease", "expandedStatus": "true"}).json()
    assert len(expanded["status"]) == 6


def test_distribution_self_exclusion_drops_own_conjunct(client: TestClient) -> None:
    q = 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq'
    on = client.get("/api/distribution", params={"field": "disease", "q": q, "facetSelfExclude": "true"}).json()
    off = client.get("/api/distribution", params={"field": "disease", "q": q}).json()
    assert on["facetSelfExclude"] is True
    assert off["facetSelfExclude"] is False
    assert on["populationQ"] == "library_strategy:RNA-Seq"
    assert off["populationQ"] == q
    assert on["statusPopulationQ"] == "library_strategy:RNA-Seq"


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
    body = client.get("/api/distribution", params={"field": "date_created"}).json()
    element = body["elements"][0]
    assert element["clauses"] == [
        {"field": "date_created", "from": f"{element['value']}-01-01", "to": f"{element['value']}-12-31"}
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
    assert cell["classification"] in (None, "gap", "under", "over")


def test_trend_returns_points_per_year(client: TestClient) -> None:
    body = client.get("/api/trend", params={"field": "tissue", "unit": "sra-experiment", "limit": 2}).json()
    assert body["years"] == sorted(body["years"])
    assert body["field"] == "tissue"
    assert len(body["series"]) <= 2
    for series in body["series"]:
        assert [p["year"] for p in series["points"]] == body["years"]
        assert series["points"][0]["clauses"][1]["field"] == "date_created"
    assert [p["year"] for p in body["total"]] == body["years"]


def test_trend_without_a_field_counts_the_condition_per_year(client: TestClient) -> None:
    body = client.get("/api/trend").json()
    assert body["field"] is None
    assert body["series"] == []
    assert body["totalPopulationQ"] is None
    assert body["populationQ"] is None
    assert [p["year"] for p in body["total"]] == body["years"]
    assert all(p["count"] > 0 for p in body["total"])
    point = body["total"][0]
    assert point["clauses"] == [
        {"field": "date_created", "from": f"{point['year']}-01-01", "to": f"{point['year']}-12-31"}
    ]
    assert sum(p["count"] for p in body["total"]) == client.get("/api/entries/biosample").json()["pagination"]["total"]


def test_trend_populations_exclude_the_year_and_the_series_dimension(client: TestClient) -> None:
    q = 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq AND date_created:[2015-01-01 TO 2016-12-31]'
    on = client.get("/api/trend", params={"q": q, "field": "disease", "facetSelfExclude": "true"}).json()
    assert on["totalPopulationQ"] == 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq'
    assert on["populationQ"] == "library_strategy:RNA-Seq"
    assert "MONDO:0007254" in [s["value"] for s in on["series"]]
    off = client.get("/api/trend", params={"q": q, "field": "disease"}).json()
    assert off["totalPopulationQ"] == off["populationQ"] == q
    assert all(2015 <= y <= 2016 for y in off["years"])


def test_trend_rejects_the_year_as_its_dimension(client: TestClient) -> None:
    response = client.get("/api/trend", params={"field": "date_created"})
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
    cell = [{"field": "cell_line", "value": "A"}, {"field": "library_strategy", "value": "RNA-Seq"}]
    narrowed = client.post(
        "/api/dsl/select", json={"q": table["populationQ"], "clauses": cell, "mode": "narrow"}
    ).json()
    assert narrowed["dsl"] == "cell_line:A AND library_strategy:RNA-Seq"
    again = client.post("/api/dsl/select", json={"q": narrowed["dsl"], "clauses": cell, "mode": "narrow"}).json()
    assert again["dsl"] == narrowed["dsl"]
    kept = client.post(
        "/api/dsl/select",
        json={"q": "(cell_line:A OR cell_line:B) AND organism_id:9606", "clauses": cell[:1], "mode": "narrow"},
    ).json()
    assert kept["dsl"] == "(cell_line:A OR cell_line:B) AND organism_id:9606 AND cell_line:A"
    invalid = client.post("/api/dsl/select", json={"q": None, "clauses": cell, "mode": "other"})
    assert invalid.status_code == 400
    assert invalid.json()["type"] == "https://ddbj.nig.ac.jp/problems/invalid-ast"


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


def test_projects_lists_bioprojects_with_composition(client: TestClient) -> None:
    body = client.get("/api/projects", params={"compositionFields": "disease,drug", "perPage": 5}).json()
    assert body["pagination"]["total"] > 0
    assert body["pagination"]["perPage"] == 5
    assert len(body["items"]) <= 5
    assert body["sort"] == "biosampleCount:desc"
    project = body["items"][0]
    assert project["clauses"] == [{"field": "bioproject", "value": project["identifier"]}]
    assert [c["field"] for c in project["composition"]] == ["disease", "drug"]
    assert all(sum(s["count"] for s in c["segments"]) == c["total"] for c in project["composition"])
    assert all(c["total"] == project["biosampleCount"] for c in project["composition"])


PROJECT_SORT_KEYS: dict[str, Callable[[dict[str, Any]], tuple[Any, ...]]] = {
    "biosampleCount:desc": lambda p: (-p["biosampleCount"], -p["experimentCount"], p["identifier"]),
    "biosampleCount:asc": lambda p: (p["biosampleCount"], p["experimentCount"], p["identifier"]),
    "experimentCount:desc": lambda p: (-p["experimentCount"], -p["biosampleCount"], p["identifier"]),
    "experimentCount:asc": lambda p: (p["experimentCount"], p["biosampleCount"], p["identifier"]),
    "identifier:asc": lambda p: (p["identifier"],),
}


@pytest.mark.parametrize("sort", [*PROJECT_SORT_KEYS, "identifier:desc"])
def test_projects_sort_each_key_and_direction_orders_all_items(client: TestClient, sort: str) -> None:
    body = client.get("/api/projects", params={"sort": sort, "perPage": 100}).json()
    assert body["sort"] == sort
    items = body["items"]
    assert len(items) == body["pagination"]["total"]
    if sort == "identifier:desc":
        assert [p["identifier"] for p in items] == sorted((p["identifier"] for p in items), reverse=True)
    else:
        assert items == sorted(items, key=PROJECT_SORT_KEYS[sort])


@pytest.mark.parametrize("sort", ["biosampleCount:asc", "identifier:desc"])
def test_projects_sort_pages_are_slices_of_one_order(client: TestClient, sort: str) -> None:
    whole = client.get("/api/projects", params={"sort": sort, "perPage": 6}).json()["items"]
    first = client.get("/api/projects", params={"sort": sort, "perPage": 3, "page": 1}).json()["items"]
    second = client.get("/api/projects", params={"sort": sort, "perPage": 3, "page": 2}).json()["items"]
    assert first + second == whole


@pytest.mark.parametrize("sort", ["biosample", "biosampleCount", "biosampleCount:up", "title:asc", ""])
def test_projects_sort_unknown_value_is_rejected(client: TestClient, sort: str) -> None:
    assert client.get("/api/projects", params={"sort": sort}).status_code == 422


def test_entries_pages_are_disjoint_and_cover_the_total(client: TestClient) -> None:
    first = client.get("/api/entries/biosample", params={"perPage": 7, "page": 1}).json()
    second = client.get("/api/entries/biosample", params={"perPage": 7, "page": 2}).json()
    assert len(first["items"]) == 7
    assert {r["biosample"] for r in first["items"]}.isdisjoint({r["biosample"] for r in second["items"]})
    by_experiment = client.get("/api/entries/sra-experiment", params={"perPage": 100}).json()
    assert by_experiment["type"] == "sra-experiment"
    assert by_experiment["pagination"]["total"] > 0
    items = by_experiment["items"]
    assert len(items) == min(100, by_experiment["pagination"]["total"])
    assert all(r["type"] == "sra-experiment" and r["experiments"] == [r["identifier"]] for r in items)


def test_entries_rows_carry_annotations_for_every_field(client: TestClient) -> None:
    row = client.get("/api/entries/biosample", params={"perPage": 1}).json()["items"][0]
    assert row["type"] == "biosample"
    assert row["identifier"] == row["biosample"]
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
    assert body["attributes"][0]["name"] == "sample_name"
    assert [a["field"] for a in body["annotations"][:5]] == ["cell_line", "disease", "tissue", "drug", "chip_antigen"]
    for annotation in body["annotations"]:
        if annotation["value"]:
            assert annotation["evidence"], annotation
            evidence = annotation["evidence"][0]
            if evidence["attributeIndex"] >= 0:
                attribute = body["attributes"][evidence["attributeIndex"]]
                assert attribute["name"] == evidence["attribute"]
                assert attribute["value"][evidence["start"] : evidence["end"]].lower() == annotation["value"].lower()
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
    expected = client.get(
        "/api/entries/biosample", params={"q": 'library_strategy:RNA-Seq AND disease:"MONDO:0007254"'}
    ).json()["pagination"]["total"]
    assert hit["count"] == expected


def test_terms_children_lists_annotated_children(client: TestClient) -> None:
    body = client.get("/api/terms/children", params={"field": "disease", "termId": "MONDO:0004992"}).json()
    ids = {c["value"] for c in body["children"]}
    assert ids <= {"MONDO:0007254", "MONDO:0005061"}
    assert all(c["count"] > 0 for c in body["children"])


def test_export_accessions_lists_one_per_line(client: TestClient) -> None:
    text = client.get("/api/export/accessions/biosample").text
    lines = text.splitlines()
    assert lines[0].startswith("# bsllmner-viewer biosample accessions")
    total = client.get("/api/entries/biosample").json()["pagination"]["total"]
    assert len(lines) - 1 == total
    assert len(set(lines[1:])) == total
    runs = client.get("/api/export/accessions/sra-run").text.splitlines()[1:]
    assert all(r.startswith("SRR") for r in runs)
    experiments = client.get("/api/export/accessions/sra-experiment").text.splitlines()[1:]
    assert len(experiments) == client.get("/api/entries/sra-experiment").json()["pagination"]["total"]


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
    total = client.get("/api/entries/biosample", params={"q": q}).json()["pagination"]["total"]
    assert tsv[0].split("\t")[:3] == ["identifier", "type", "biosample"]
    assert "libraryStrategy" in tsv[0].split("\t")
    assert len(tsv) - 1 == total
    assert {len(line.split("\t")) for line in tsv} == {len(tsv[0].split("\t"))}
    response = client.get("/api/export/entries/biosample", params={"format": "ndjson", "q": q})
    assert response.headers["content-type"].startswith("application/x-ndjson")
    lines = [orjson.loads(line) for line in response.text.splitlines()]
    assert len(lines) == total
    listed = client.get("/api/entries/biosample", params={"q": q, "perPage": 100}).json()["items"]
    assert lines[: len(listed)] == listed


def test_export_entries_of_experiments_has_one_line_per_experiment(client: TestClient) -> None:
    lines = [
        orjson.loads(line)
        for line in client.get("/api/export/entries/sra-experiment", params={"format": "ndjson"}).text.splitlines()
    ]
    assert lines
    assert all(line["type"] == "sra-experiment" and line["experiments"] == [line["identifier"]] for line in lines)


def test_export_entries_rejects_the_former_json_format(client: TestClient) -> None:
    assert client.get("/api/export/entries/biosample", params={"format": "json"}).status_code == 422
