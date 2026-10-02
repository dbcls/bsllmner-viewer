from __future__ import annotations

from fastapi.testclient import TestClient

from tests.synthetic import Synthetic


def test_dataset_reports_version_fields_and_totals(client: TestClient) -> None:
    body = client.get("/api/dataset").json()
    assert body["dataset_version"]["name"] == "synthetic"
    assert len(body["dataset_version"]["digest"]) == 16
    assert [f["name"] for f in body["fields"]] == ["cell_line", "disease", "tissue", "drug", "chip_antigen"]
    assert body["fields"][1]["ontologies"] == ["MONDO"]
    assert body["totals"]["record"] > 0
    assert list(body["statuses"]) == ["mapped", "unmapped", "no_value"]
    assert {o["organism_id"] for o in body["organisms"]} <= {9606, 10090}


def test_every_response_carries_the_same_dataset_version(client: TestClient) -> None:
    ref = client.get("/api/dataset").json()["dataset_version"]
    for path in (
        "/api/distribution?field=disease",
        "/api/records",
        "/api/projects",
        "/api/dsl/parse?q=disease_status:mapped",
    ):
        assert client.get(path).json()["dataset_version"] == ref


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
        "/api/dsl/parse", params={"q": "date_created:[2015-01-01 TO 2020-12-31] AND NOT title:tumor"}
    ).json()
    body = client.post("/api/dsl/serialize", json={"ast": parsed["ast"]}).json()
    assert body["q"] == parsed["q"]
    assert body["ast"] == parsed["ast"]


def test_select_builds_the_documented_condition(client: TestClient) -> None:
    q = None
    for clause in (
        {"field": "disease", "value": "A"},
        {"field": "library_strategy", "value": "ATAC-seq"},
        {"field": "disease", "value": "B"},
    ):
        q = client.post("/api/dsl/select", json={"q": q, "clauses": [clause]}).json()["q"]
    assert q == "(disease:A OR disease:B) AND library_strategy:ATAC-seq"
    removed = client.post("/api/dsl/select", json={"q": q, "clauses": [{"field": "disease", "value": "A"}]}).json()
    assert removed["q"] == "disease:B AND library_strategy:ATAC-seq"
    year = client.post(
        "/api/dsl/select",
        json={"q": None, "clauses": [{"field": "date_created", "from": "2020-01-01", "to": "2020-12-31"}]},
    ).json()
    assert year["q"] == "date_created:[2020-01-01 TO 2020-12-31]"


def test_invalid_conditions_are_problem_documents(client: TestClient) -> None:
    for q, slug in (
        ("cancer", "free-text-not-supported"),
        ("nope:x", "unknown-field"),
        ("disease:(", "unexpected-token"),
    ):
        response = client.get("/api/records", params={"q": q})
        assert response.status_code == 400, q
        assert response.headers["content-type"].startswith("application/problem+json")
        body = response.json()
        assert body["type"] == f"/problems/{slug}"
        assert body["status"] == 400
        assert body["instance"] == "/api/records"


def test_invalid_ast_is_a_problem_document(client: TestClient) -> None:
    response = client.post("/api/dsl/serialize", json={"ast": {"op": "XOR"}})
    assert response.status_code == 400
    assert response.json()["type"] == "/problems/invalid-ast"


def test_invalid_query_parameters_are_problem_documents(client: TestClient) -> None:
    response = client.get("/api/records", params={"page": 0})
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert client.get("/api/distribution", params={"field": "title"}).json()["type"] == "/problems/invalid-dimension"


def test_distribution_returns_elements_with_clauses_and_status(client: TestClient) -> None:
    body = client.get("/api/distribution", params={"field": "disease", "unit": "biosample"}).json()
    assert body["field"] == "disease"
    assert body["population_q"] is None
    assert body["total"] > 0
    assert 0 < len(body["elements"]) <= 10
    first = body["elements"][0]
    assert first["clauses"] == [{"field": "disease", "value": first["value"]}]
    assert first["count"] >= first["count_exact"] + 0
    assert {s["value"] for s in body["status"]} == {"mapped", "unmapped", "no_value"}
    expanded = client.get("/api/distribution", params={"field": "disease", "expanded_status": "true"}).json()
    assert len(expanded["status"]) == 6


def test_distribution_self_exclusion_drops_own_conjunct(client: TestClient) -> None:
    q = 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq'
    on = client.get("/api/distribution", params={"field": "disease", "q": q}).json()
    off = client.get("/api/distribution", params={"field": "disease", "q": q, "self_exclusion": "false"}).json()
    assert on["population_q"] == "library_strategy:RNA-Seq"
    assert off["population_q"] == q
    assert on["status_population_q"] == "library_strategy:RNA-Seq"


def test_redundant_parentheses_do_not_change_the_population(client: TestClient) -> None:
    flat = 'disease:"MONDO:0007254" AND title:run1 AND disease:"MONDO:0005061"'
    nested = 'disease:"MONDO:0007254" AND (title:run1 AND disease:"MONDO:0005061")'
    for path, params in (
        ("/api/distribution", {"field": "disease"}),
        ("/api/crosstab", {"row": "disease", "col": "library_strategy"}),
        ("/api/trend", {"field": "disease"}),
    ):
        a = client.get(path, params={**params, "q": flat}).json()
        b = client.get(path, params={**params, "q": nested}).json()
        assert a["q"] == b["q"] == flat
        assert a["population_q"] == b["population_q"] == "title:run1", path
    assert client.get("/api/trend", params={"q": nested}).json()["total_population_q"] == flat
    clause = {"field": "title", "value": "run1"}
    selected = [client.post("/api/dsl/select", json={"q": q, "clauses": [clause]}).json()["q"] for q in (flat, nested)]
    assert selected[0] == selected[1] == 'disease:"MONDO:0007254" AND disease:"MONDO:0005061"'


def test_distribution_year_elements_carry_range_clauses(client: TestClient) -> None:
    body = client.get("/api/distribution", params={"field": "date_created"}).json()
    element = body["elements"][0]
    assert element["clauses"] == [
        {"field": "date_created", "from": f"{element['value']}-01-01", "to": f"{element['value']}-12-31"}
    ]


def test_crosstab_returns_cells_with_expected_counts(client: TestClient) -> None:
    body = client.get("/api/crosstab", params={"row": "disease", "col": "library_strategy", "unit": "biosample"}).json()
    assert body["rows"]
    assert body["cols"]
    assert len(body["cells"]) == len(body["rows"]) * len(body["cols"])
    cell = body["cells"][0]
    r = next(x for x in body["rows"] if x["value"] == cell["row"])["count"]
    c = next(x for x in body["cols"] if x["value"] == cell["col"])["count"]
    assert cell["expected"] == r * c / body["total"]
    assert cell["classification"] in (None, "gap", "under", "over")


def test_trend_returns_points_per_year(client: TestClient) -> None:
    body = client.get("/api/trend", params={"field": "tissue", "unit": "experiment", "limit": 2}).json()
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
    assert body["total_population_q"] is None
    assert body["population_q"] is None
    assert [p["year"] for p in body["total"]] == body["years"]
    assert all(p["count"] > 0 for p in body["total"])
    point = body["total"][0]
    assert point["clauses"] == [
        {"field": "date_created", "from": f"{point['year']}-01-01", "to": f"{point['year']}-12-31"}
    ]
    assert sum(p["count"] for p in body["total"]) == client.get("/api/records").json()["total"]


def test_trend_populations_exclude_the_year_and_the_series_dimension(client: TestClient) -> None:
    q = 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq AND date_created:[2015-01-01 TO 2016-12-31]'
    on = client.get("/api/trend", params={"q": q, "field": "disease"}).json()
    assert on["total_population_q"] == 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq'
    assert on["population_q"] == "library_strategy:RNA-Seq"
    assert "MONDO:0007254" in [s["value"] for s in on["series"]]
    off = client.get("/api/trend", params={"q": q, "field": "disease", "self_exclusion": "false"}).json()
    assert off["total_population_q"] == off["population_q"] == q
    assert all(2015 <= y <= 2016 for y in off["years"])


def test_trend_rejects_the_year_as_its_dimension(client: TestClient) -> None:
    response = client.get("/api/trend", params={"field": "date_created"})
    assert response.status_code == 400
    assert response.json()["type"] == "/problems/invalid-dimension"


def test_select_narrow_builds_the_documented_condition(client: TestClient) -> None:
    table = client.get(
        "/api/crosstab", params={"row": "cell_line", "col": "library_strategy", "q": "library_strategy:ChIP-Seq"}
    ).json()
    assert table["population_q"] is None
    cell = [{"field": "cell_line", "value": "A"}, {"field": "library_strategy", "value": "RNA-Seq"}]
    narrowed = client.post(
        "/api/dsl/select", json={"q": table["population_q"], "clauses": cell, "mode": "narrow"}
    ).json()
    assert narrowed["q"] == "cell_line:A AND library_strategy:RNA-Seq"
    again = client.post("/api/dsl/select", json={"q": narrowed["q"], "clauses": cell, "mode": "narrow"}).json()
    assert again["q"] == narrowed["q"]
    kept = client.post(
        "/api/dsl/select",
        json={"q": "(cell_line:A OR cell_line:B) AND title:x", "clauses": cell[:1], "mode": "narrow"},
    ).json()
    assert kept["q"] == "(cell_line:A OR cell_line:B) AND title:x AND cell_line:A"
    assert client.post("/api/dsl/select", json={"q": None, "clauses": cell, "mode": "other"}).status_code == 422


def _two_disease_terms(client: TestClient) -> tuple[str, str]:
    elements = client.get("/api/distribution", params={"field": "disease", "limit": 50}).json()["elements"]
    top = client.get("/api/distribution", params={"field": "disease", "limit": 1}).json()["elements"][0]["value"]
    other = next(e["value"] for e in reversed(elements) if e["value"] != top)
    return top, other


def test_default_elements_include_the_terms_the_condition_names(client: TestClient) -> None:
    top, other = _two_disease_terms(client)
    plain = client.get("/api/distribution", params={"field": "disease", "limit": 1}).json()
    assert [e["value"] for e in plain["elements"]] == [top]
    named = client.get("/api/distribution", params={"field": "disease", "limit": 1, "q": f'disease:"{other}"'}).json()
    assert {e["value"] for e in named["elements"]} == {top, other}
    counts = [e["count"] for e in named["elements"]]
    assert counts == sorted(counts, reverse=True)
    table = client.get(
        "/api/crosstab", params={"row": "disease", "col": "library_strategy", "limit": 1, "q": f'disease:"{other}"'}
    ).json()
    assert {r["value"] for r in table["rows"]} == {top, other}
    trend = client.get("/api/trend", params={"field": "disease", "limit": 1, "q": f'disease:"{other}"'}).json()
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
    body = client.get("/api/projects", params={"composition_fields": "disease,drug", "per_page": 5}).json()
    assert body["total"] > 0
    assert len(body["projects"]) <= 5
    project = body["projects"][0]
    assert project["clauses"] == [{"field": "bioproject", "value": project["bioproject"]}]
    assert [c["field"] for c in project["composition"]] == ["disease", "drug"]
    assert all(sum(s["count"] for s in c["segments"]) == c["total"] for c in project["composition"])
    assert all(c["total"] == project["n_biosample"] for c in project["composition"])
    by_experiment = client.get("/api/projects", params={"sort": "experiment"}).json()["projects"]
    assert [p["n_experiment"] for p in by_experiment] == sorted(
        (p["n_experiment"] for p in by_experiment), reverse=True
    )


def test_records_pages_are_disjoint_and_cover_the_total(client: TestClient) -> None:
    first = client.get("/api/records", params={"per_page": 7, "page": 1}).json()
    second = client.get("/api/records", params={"per_page": 7, "page": 2}).json()
    assert len(first["records"]) == 7
    assert {r["biosample"] for r in first["records"]}.isdisjoint({r["biosample"] for r in second["records"]})
    by_experiment = client.get("/api/records", params={"unit": "experiment", "per_page": 200}).json()
    assert by_experiment["total"] == len(by_experiment["records"])
    assert all(r["experiment"] and r["experiments"] == [r["experiment"]] for r in by_experiment["records"])


def test_records_rows_carry_annotations_for_every_field(client: TestClient) -> None:
    row = client.get("/api/records", params={"per_page": 1}).json()["records"][0]
    assert list(row["annotations"]) == ["cell_line", "disease", "tissue", "drug", "chip_antigen"]
    assert all(a["status"] for values in row["annotations"].values() for a in values)


def test_entry_returns_attributes_annotations_and_evidence(client: TestClient, synthetic: Synthetic) -> None:
    accession = synthetic.accessions[0]
    body = client.get(f"/api/entries/{accession}").json()
    assert body["accession"] == accession
    assert body["attributes"][0]["name"] == "sample_name"
    assert [a["field"] for a in body["annotations"][:5]] == ["cell_line", "disease", "tissue", "drug", "chip_antigen"]
    for annotation in body["annotations"]:
        if annotation["value"]:
            assert annotation["evidence"], annotation
            evidence = annotation["evidence"][0]
            if evidence["attribute_index"] >= 0:
                attribute = body["attributes"][evidence["attribute_index"]]
                assert attribute["name"] == evidence["attribute"]
                assert attribute["value"][evidence["start"] : evidence["end"]].lower() == annotation["value"].lower()
    assert {e["accession"] for e in body["experiments"]} == {srx for srx, _ in synthetic.truth.experiments[accession]}
    assert client.get("/api/entries/SAMN_NONE").status_code == 404


def test_terms_search_matches_label_synonym_and_id(client: TestClient) -> None:
    for query in ("breast", "mammary", "MONDO:0007254"):
        hits = client.get("/api/terms", params={"field": "disease", "query": query}).json()["terms"]
        assert any(h["term_id"] == "MONDO:0007254" for h in hits), query
    hit = next(
        h
        for h in client.get("/api/terms", params={"field": "disease", "query": "breast carcinoma"}).json()["terms"]
        if h["term_id"] == "MONDO:0004989"
    )
    assert hit["path"][-1] == "breast cancer"
    assert hit["clauses"] == [{"field": "disease", "value": "MONDO:0004989"}]
    assert client.get("/api/terms", params={"field": "title", "query": "x"}).status_code == 400


def test_terms_search_without_a_field_searches_every_annotation_field(client: TestClient) -> None:
    fields = {f["name"] for f in client.get("/api/dataset").json()["fields"]}
    body = client.get("/api/terms", params={"query": "breast"}).json()
    assert body["field"] is None
    assert body["population_q"] is None
    assert ("disease", "MONDO:0007254") in {(h["field"], h["term_id"]) for h in body["terms"]}
    assert all(
        h["field"] in fields and h["clauses"] == [{"field": h["field"], "value": h["term_id"]}] for h in body["terms"]
    )
    by_synonym = client.get("/api/terms", params={"query": "K562"}).json()["terms"]
    assert [(h["field"], h["term_id"]) for h in by_synonym] == [("cell_line", "CVCL:0004")]
    by_id = client.get("/api/terms", params={"query": "ncbigene:10664"}).json()["terms"]
    assert [(h["field"], h["label"]) for h in by_id] == [("chip_antigen", "CTCF")]


def test_terms_search_without_a_query_lists_terms_of_several_fields_within_the_limit(client: TestClient) -> None:
    body = client.get("/api/terms", params={"limit": 8}).json()
    assert len(body["terms"]) == 8
    assert len({h["field"] for h in body["terms"]}) > 1
    assert len({(h["field"], h["term_id"]) for h in body["terms"]}) == 8
    assert client.get("/api/terms", params={"query": "no such term text"}).json()["terms"] == []


def test_terms_search_treats_like_wildcards_in_the_query_as_text(client: TestClient) -> None:
    assert client.get("/api/terms", params={"query": "%"}).json()["terms"] == []
    assert client.get("/api/terms", params={"query": "_"}).json()["terms"] == []


def test_terms_search_counts_each_hit_without_the_conjuncts_on_its_own_field(client: TestClient) -> None:
    q = 'disease:"MONDO:0005061" AND library_strategy:RNA-Seq'
    hit = next(
        h
        for h in client.get("/api/terms", params={"query": "breast cancer", "q": q}).json()["terms"]
        if (h["field"], h["term_id"]) == ("disease", "MONDO:0007254")
    )
    expected = client.get("/api/records", params={"q": 'library_strategy:RNA-Seq AND disease:"MONDO:0007254"'}).json()[
        "total"
    ]
    assert hit["count"] == expected


def test_terms_children_lists_annotated_children(client: TestClient) -> None:
    body = client.get("/api/terms/children", params={"field": "disease", "term_id": "MONDO:0004992"}).json()
    ids = {c["value"] for c in body["children"]}
    assert ids <= {"MONDO:0007254", "MONDO:0005061"}
    assert all(c["count"] > 0 for c in body["children"])


def test_export_accessions_lists_one_per_line(client: TestClient) -> None:
    text = client.get("/api/export/accessions", params={"kind": "biosample"}).text
    lines = text.splitlines()
    assert lines[0].startswith("# bsllmner-viewer biosample accessions")
    total = client.get("/api/records").json()["total"]
    assert len(lines) - 1 == total
    assert len(set(lines[1:])) == total
    runs = client.get("/api/export/accessions", params={"kind": "run"}).text.splitlines()[1:]
    assert all(r.startswith("SRR") for r in runs)


def test_export_records_tsv_and_json(client: TestClient) -> None:
    tsv = client.get("/api/export/records", params={"format": "tsv", "q": "library_strategy:RNA-Seq"}).text.splitlines()
    total = client.get("/api/records", params={"q": "library_strategy:RNA-Seq"}).json()["total"]
    assert tsv[0].split("\t")[:2] == ["biosample", "experiment"]
    assert len(tsv) - 1 == total
    jsonl = client.get(
        "/api/export/records", params={"format": "json", "q": "library_strategy:RNA-Seq"}
    ).text.splitlines()
    assert '"dataset_version"' in jsonl[0]
    assert len(jsonl) - 1 == total
