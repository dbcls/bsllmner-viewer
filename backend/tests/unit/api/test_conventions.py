"""Conventions shared with the DDBJ Search API: naming, pagination, problems, request IDs, and the OpenAPI document."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import duckdb
import orjson
import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer import __version__
from bsllmner_viewer.api.app import API_VERSION, create_app
from bsllmner_viewer.store.version import read_version

PROBLEM_PREFIX = "https://ddbj.nig.ac.jp/problems/"
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")

# Subtrees whose keys are DSL field names, labels keyed by term IDs, or the AST of the DDBJ Search API.
OPAQUE_KEYS = frozenset({"ast", "labels", "statuses"})


def _snake_case_keys(node: Any, path: str = "$") -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if "_" in key:
                found.append(f"{path}.{key}")
            if key in OPAQUE_KEYS:
                continue
            if key == "annotations" and isinstance(value, dict):
                for field, values in value.items():
                    found.extend(_snake_case_keys(values, f"{path}.annotations.{field}"))
                continue
            found.extend(_snake_case_keys(value, f"{path}.{key}"))
    elif isinstance(node, list):
        for i, item in enumerate(node):
            found.extend(_snake_case_keys(item, f"{path}[{i}]"))
    return found


def _first(client: TestClient, path: str, **params: str) -> dict[str, Any]:
    body: dict[str, Any] = client.get(path, params=params).json()
    return body


@pytest.fixture
def isolated_client(store_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(store_path), raise_server_exceptions=False) as client:
        yield client


class TestCamelCase:
    def test_responses_have_no_snake_case_keys_outside_dsl_names(self, client: TestClient, synthetic: Any) -> None:
        accession = synthetic.accessions[0]
        disease = 'disease:"MONDO:0007254"'
        responses = [
            client.get("/api/dataset"),
            client.get("/api/service-info"),
            client.get("/api/entries/biosample", params={"q": disease}),
            client.get("/api/entries/sra-experiment", params={"q": disease}),
            client.get(f"/api/entries/biosample/{accession}"),
            client.get("/api/distribution", params={"field": "disease", "q": disease}),
            client.get("/api/distribution", params={"field": "disease_status", "expandedStatus": "true"}),
            client.get(
                "/api/crosstab", params={"row": "disease", "col": "library_strategy", "rowElements": "MONDO:0007254"}
            ),
            client.get("/api/trend", params={"field": "disease", "q": disease}),
            client.get("/api/projects", params={"compositionFields": "disease,drug", "q": disease}),
            client.get("/api/terms", params={"query": "breast", "q": disease}),
            client.get("/api/terms/children", params={"field": "disease", "termId": "MONDO:0004992"}),
            client.get("/api/dsl/parse", params={"q": f"{disease} AND date_created:[2015-01-01 TO 2020-12-31]"}),
            client.post("/api/dsl/serialize", json={"ast": {"field": "organism_id", "op": "eq", "value": "9606"}}),
            client.post("/api/dsl/select", json={"q": None, "clauses": [{"field": "cell_line", "value": "A"}]}),
        ]
        for response in responses:
            assert response.status_code == 200, response.url
            assert _snake_case_keys(response.json()) == [], response.url

    def test_problems_have_no_snake_case_keys(self, client: TestClient) -> None:
        body = client.get("/api/entries/biosample", params={"q": "nope:x"}).json()
        assert _snake_case_keys(body) == []
        assert "requestId" in body

    def test_snake_case_query_parameters_are_not_accepted(self, client: TestClient) -> None:
        # An unknown parameter is ignored, so the default of the camelCase parameter applies.
        q = 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq'
        body = _first(
            client, "/api/distribution", field="disease", q=q, self_exclusion="true", facet_self_exclude="true"
        )
        assert body["facetSelfExclude"] is False
        paged = _first(client, "/api/entries/biosample", per_page="3")
        assert paged["pagination"]["perPage"] == 25

    def test_dsl_names_stay_snake_case_inside_conditions(self, client: TestClient) -> None:
        body = _first(client, "/api/dsl/parse", q="organism_id:9606 AND date_created:[2015-01-01 TO 2016-01-01]")
        assert body["q"] == "organism_id:9606 AND date_created:[2015-01-01 TO 2016-01-01]"
        assert [r["field"] for r in body["ast"]["rules"]] == ["organism_id", "date_created"]
        assert body["ast"]["rules"][1]["from"] == "2015-01-01"
        assert set(body["labels"]) == {"9606"}

    def test_free_text_ast_keeps_is_phrase(self, client: TestClient) -> None:
        response = client.post("/api/dsl/serialize", json={"ast": {"op": "free_text", "value": "x", "is_phrase": True}})
        assert response.status_code == 400
        assert response.json()["type"] == PROBLEM_PREFIX + "free-text-not-supported"


class TestDatasetVersion:
    def test_digest_is_computed_from_the_stored_information(
        self, client: TestClient, store_con: duckdb.DuckDBPyConnection
    ) -> None:
        version = read_version(store_con)
        digest = hashlib.sha256(orjson.dumps(version.model_dump(), option=orjson.OPT_SORT_KEYS)).hexdigest()[:16]
        body = _first(client, "/api/dataset")
        assert body["datasetVersion"]["digest"] == digest
        assert set(body["datasetVersion"]) == {"name", "createdAt", "model", "digest"}

    def test_version_keys_are_camel_case_at_every_depth(self, client: TestClient) -> None:
        version = _first(client, "/api/dataset")["version"]
        assert set(version) == {
            "name",
            "createdAt",
            "model",
            "targetAssays",
            "runs",
            "ontologies",
            "referenceSnapshots",
        }
        assert set(version["runs"][0]) == {"name", "mk2Version", "selectConfigSha256"}
        assert set(version["referenceSnapshots"]) == {"sraExperiments", "dblink", "bioprojects", "chipAtlas"}


class TestFacetSelfExclude:
    Q = 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq AND date_created:[2015-01-01 TO 2020-12-31]'

    @pytest.mark.parametrize(
        ("path", "params", "own"),
        [
            ("/api/distribution", {"field": "disease"}, 'disease:"MONDO:0007254"'),
            ("/api/crosstab", {"row": "disease", "col": "library_strategy"}, None),
            ("/api/terms", {"field": "disease", "query": "breast"}, 'disease:"MONDO:0007254"'),
            ("/api/terms/children", {"field": "disease", "termId": "MONDO:0004992"}, 'disease:"MONDO:0007254"'),
        ],
    )
    def test_default_keeps_q_and_true_drops_own_conjuncts(
        self, client: TestClient, path: str, params: dict[str, str], own: str | None
    ) -> None:
        default = _first(client, path, q=self.Q, **params)
        off = _first(client, path, q=self.Q, facetSelfExclude="false", **params)
        on = _first(client, path, q=self.Q, facetSelfExclude="true", **params)
        assert default["populationQ"] == off["populationQ"] == self.Q
        assert on["populationQ"] != self.Q
        assert on["populationQ"] is None or len(on["populationQ"]) < len(self.Q)
        for body, flag in ((default, False), (off, False), (on, True)):
            if "facetSelfExclude" in body:
                assert body["facetSelfExclude"] is flag
        if own is not None:
            assert own not in (on["populationQ"] or "")

    def test_crosstab_true_drops_both_axes(self, client: TestClient) -> None:
        on = _first(client, "/api/crosstab", row="disease", col="library_strategy", q=self.Q, facetSelfExclude="true")
        assert on["populationQ"] == "date_created:[2015-01-01 TO 2020-12-31]"

    def test_projects_true_drops_bioproject_conjuncts_only(self, client: TestClient) -> None:
        project = _first(client, "/api/projects", perPage="1")["items"][0]["identifier"]
        q = f"bioproject:{project} AND library_strategy:RNA-Seq"
        default = _first(client, "/api/projects", q=q)
        on = _first(client, "/api/projects", q=q, facetSelfExclude="true")
        assert default["populationQ"] == q
        assert default["pagination"]["total"] >= 1
        assert on["populationQ"] == "library_strategy:RNA-Seq"
        assert on["pagination"]["total"] >= default["pagination"]["total"]

    def test_trend_populations_follow_the_flag(self, client: TestClient) -> None:
        default = _first(client, "/api/trend", q=self.Q, field="disease")
        on = _first(client, "/api/trend", q=self.Q, field="disease", facetSelfExclude="true")
        assert default["totalPopulationQ"] == default["populationQ"] == self.Q
        assert on["totalPopulationQ"] == 'disease:"MONDO:0007254" AND library_strategy:RNA-Seq'
        assert on["populationQ"] == "library_strategy:RNA-Seq"
        assert default["facetSelfExclude"] is False
        assert on["facetSelfExclude"] is True


class TestPagination:
    @pytest.mark.parametrize("path", ["/api/entries/biosample", "/api/entries/sra-experiment", "/api/projects"])
    @pytest.mark.parametrize("per_page", [0, 101, -1, 1000])
    def test_per_page_outside_one_to_one_hundred_is_rejected(
        self, client: TestClient, path: str, per_page: int
    ) -> None:
        response = client.get(path, params={"perPage": per_page})
        assert response.status_code == 422
        assert response.json()["type"] == "about:blank"

    @pytest.mark.parametrize("path", ["/api/entries/biosample", "/api/entries/sra-experiment", "/api/projects"])
    @pytest.mark.parametrize("per_page", [1, 100])
    def test_per_page_bounds_are_accepted(self, client: TestClient, path: str, per_page: int) -> None:
        body = _first(client, path, perPage=str(per_page))
        assert body["pagination"]["perPage"] == per_page
        assert len(body["items"]) == min(per_page, body["pagination"]["total"])

    @pytest.mark.parametrize("path", ["/api/entries/biosample", "/api/projects"])
    def test_page_zero_is_rejected(self, client: TestClient, path: str) -> None:
        assert client.get(path, params={"page": 0}).status_code == 422

    @pytest.mark.parametrize("path", ["/api/entries/biosample", "/api/entries/sra-experiment", "/api/projects"])
    def test_last_page_has_no_next_and_the_page_after_is_empty(self, client: TestClient, path: str) -> None:
        total = _first(client, path, perPage="1")["pagination"]["total"]
        assert total > 2
        per_page = 7
        last = -(-total // per_page)
        body = _first(client, path, perPage=str(per_page), page=str(last))
        assert body["pagination"]["hasNext"] is False
        assert len(body["items"]) == total - (last - 1) * per_page
        previous = _first(client, path, perPage=str(per_page), page=str(last - 1))
        assert previous["pagination"]["hasNext"] is True
        beyond = _first(client, path, perPage=str(per_page), page=str(last + 1))
        assert beyond["items"] == []
        assert beyond["pagination"] == {"page": last + 1, "perPage": per_page, "total": total, "hasNext": False}

    def test_total_equal_to_a_multiple_of_per_page_has_no_next_on_the_last_page(self, client: TestClient) -> None:
        total = _first(client, "/api/entries/biosample", perPage="1")["pagination"]["total"]
        body = _first(client, "/api/entries/biosample", perPage=str(total), page="1")
        assert body["pagination"]["hasNext"] is False
        assert len(body["items"]) == min(total, 100)

    def test_empty_result_has_no_items_and_no_next(self, client: TestClient) -> None:
        body = _first(client, "/api/entries/biosample", q='disease:"MONDO:9999999"')
        assert body["items"] == []
        assert body["pagination"] == {"page": 1, "perPage": 25, "total": 0, "hasNext": False}

    @settings(max_examples=40)
    @given(st.integers(1, 100), st.integers(1, 8), st.sampled_from(["biosample", "sra-experiment"]))
    def test_pagination_describes_the_page(self, client: TestClient, per_page: int, page: int, kind: str) -> None:
        body = _first(client, f"/api/entries/{kind}", perPage=str(per_page), page=str(page))
        pagination = body["pagination"]
        total = pagination["total"]
        assert pagination["page"] == page
        assert pagination["perPage"] == per_page
        assert pagination["hasNext"] is (page * per_page < total)
        assert len(body["items"]) == max(0, min(per_page, total - (page - 1) * per_page))

    def test_pages_of_experiments_do_not_overlap(self, client: TestClient) -> None:
        first = _first(client, "/api/entries/sra-experiment", perPage="10", page="1")["items"]
        second = _first(client, "/api/entries/sra-experiment", perPage="10", page="2")["items"]
        assert {i["identifier"] for i in first}.isdisjoint({i["identifier"] for i in second})


class TestPaths:
    @pytest.mark.parametrize(
        "path",
        [
            "/api/entries/SAMN00000001",
            "/api/entries/sra-run",
            "/api/entries/bioproject",
            "/api/entries/biosampel",
            "/api/export/entries/sra-run",
            "/api/export/accessions/experiment",
        ],
    )
    def test_unknown_entry_type_is_not_found(self, client: TestClient, path: str) -> None:
        response = client.get(path)
        assert response.status_code == 404
        assert response.headers["content-type"].startswith("application/problem+json")
        body = response.json()
        assert body["type"] == "about:blank"
        assert body["title"] == "Not Found"
        assert body["status"] == 404
        assert body["instance"] == path

    @pytest.mark.parametrize(
        "path",
        ["/health", "/api/health", "/api/records", "/api/export/records", "/api/export/accessions", "/api/docs"],
    )
    def test_removed_paths_are_not_found(self, client: TestClient, path: str) -> None:
        assert client.get(path).status_code in (404, 405)

    @pytest.mark.parametrize("path", ["/api/dataset/", "/api/entries/biosample/", "/api/service-info/"])
    def test_trailing_slash_is_not_redirected(self, client: TestClient, path: str) -> None:
        response = client.get(path, follow_redirects=False)
        assert response.status_code == 404
        assert response.json()["type"] == "about:blank"

    def test_unknown_accession_is_not_found(self, client: TestClient) -> None:
        response = client.get("/api/entries/biosample/SAMN_NONE")
        assert response.status_code == 404
        body = response.json()
        assert body["type"] == "about:blank"
        assert "SAMN_NONE" in body["detail"]

    def test_accession_of_a_biosample_is_not_an_experiment_entry(self, client: TestClient, synthetic: Any) -> None:
        accession = synthetic.accessions[0]
        assert client.get(f"/api/entries/sra-experiment/{accession}").status_code == 404

    def test_method_not_allowed_is_a_problem(self, client: TestClient) -> None:
        response = client.post("/api/entries/biosample")
        assert response.status_code == 405
        assert response.json()["type"] == "about:blank"
        assert response.json()["title"] == "Method Not Allowed"


class TestProblems:
    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"ast": None},
            {"ast": "x"},
            {"ast": []},
            {"nope": 1},
            {"ast": {"op": "XOR"}},
            {"ast": {"op": "AND", "rules": []}},
            {"ast": {"field": "disease", "op": "eq"}},
        ],
    )
    def test_invalid_serialize_body_is_invalid_ast(self, client: TestClient, body: dict[str, Any]) -> None:
        response = client.post("/api/dsl/serialize", json=body)
        assert response.status_code == 400
        assert response.headers["content-type"].startswith("application/problem+json")
        assert response.json()["type"] == PROBLEM_PREFIX + "invalid-ast"
        assert response.json()["title"] == "Bad Request"

    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"clauses": []},
            {"clauses": [{"value": "x"}]},
            {"clauses": [{"field": "disease", "value": "x"}], "mode": "other"},
            {"clauses": [{"field": "disease", "from": "2020-01-01"}]},
            {"q": 5, "clauses": [{"field": "disease", "value": "x"}]},
        ],
    )
    def test_invalid_select_body_is_invalid_ast(self, client: TestClient, body: dict[str, Any]) -> None:
        response = client.post("/api/dsl/select", json=body)
        assert response.status_code == 400
        assert response.json()["type"] == PROBLEM_PREFIX + "invalid-ast"

    def test_malformed_json_body_is_invalid_ast(self, client: TestClient) -> None:
        response = client.post("/api/dsl/serialize", content=b"{not json", headers={"content-type": "application/json"})
        assert response.status_code == 400
        assert response.json()["type"] == PROBLEM_PREFIX + "invalid-ast"

    def test_invalid_query_parameter_is_unprocessable(self, client: TestClient) -> None:
        for path, params in (
            ("/api/dsl/parse", {}),
            ("/api/distribution", {}),
            ("/api/distribution", {"field": "disease", "limit": "0"}),
            ("/api/distribution", {"field": "disease", "unit": "experiment"}),
            ("/api/entries/biosample", {"page": "x"}),
            ("/api/export/entries/biosample", {"format": "json"}),
        ):
            response = client.get(path, params=params)
            assert response.status_code == 422, (path, params)
            body = response.json()
            assert body["type"] == "about:blank"
            assert body["title"] == "Unprocessable Entity"
            assert body["detail"]

    @pytest.mark.parametrize("unit", ["biosample", "sra-experiment", "bioproject"])
    def test_counting_units_are_accepted(self, client: TestClient, unit: str) -> None:
        body = _first(client, "/api/distribution", field="library_strategy", unit=unit)
        assert body["unit"] == unit

    def test_api_specific_errors_use_the_problem_namespace(self, client: TestClient) -> None:
        cases = [
            (client.get("/api/distribution", params={"field": "title"}), "invalid-dimension"),
            (client.get("/api/trend", params={"field": "date_created"}), "invalid-dimension"),
            (
                client.get("/api/terms/children", params={"field": "library_strategy", "termId": "x"}),
                "invalid-dimension",
            ),
            (
                client.get("/api/distribution", params={"field": "disease_status", "elements": "bogus"}),
                "invalid-element",
            ),
            (
                client.get(
                    "/api/distribution",
                    params={"field": "disease", "elements": ",".join("a" * 1 + str(i) for i in range(501))},
                ),
                "too-many-elements",
            ),
            (client.get("/api/projects", params={"compositionFields": "title"}), "unknown-field"),
            (
                client.get("/api/projects", params={"compositionFields": "disease,drug,tissue,cell_line"}),
                "too-many-fields",
            ),
            (client.get("/api/entries/biosample", params={"q": "nope:x"}), "unknown-field"),
        ]
        for response, slug in cases:
            assert response.status_code == 400, slug
            body = response.json()
            assert body["type"] == PROBLEM_PREFIX + slug
            assert body["title"] == "Bad Request"

    def test_former_slugs_are_gone(self, client: TestClient) -> None:
        types = {
            client.get("/api/entries/biosample/SAMN_NONE").json()["type"],
            client.get("/api/entries/biosample", params={"page": 0}).json()["type"],
        }
        assert types == {"about:blank"}

    def test_problem_body_has_the_documented_keys(self, client: TestClient) -> None:
        response = client.get("/api/entries/biosample", params={"q": "nope:x"})
        body = response.json()
        assert set(body) == {"type", "title", "status", "detail", "instance", "timestamp", "requestId"}
        assert body["requestId"] == response.headers["x-request-id"]

    def test_timestamp_is_iso_8601_in_utc_with_z_suffix(self, client: TestClient) -> None:
        before = datetime.now().astimezone()
        timestamp = client.get("/api/entries/biosample/SAMN_NONE").json()["timestamp"]
        after = datetime.now().astimezone()
        assert TIMESTAMP.match(timestamp), timestamp
        parsed = datetime.fromisoformat(timestamp)
        assert parsed.utcoffset() is not None
        assert before.replace(microsecond=0) <= parsed <= after

    def test_unhandled_exception_is_a_problem_without_internal_details(self, isolated_client: TestClient) -> None:
        def boom() -> None:
            raise RuntimeError("secret internal detail")

        isolated_client.app.add_api_route("/api/boom", boom)  # type: ignore[attr-defined]
        response = isolated_client.get("/api/boom", headers={"X-Request-ID": "req-500"})
        assert response.status_code == 500
        assert response.headers["content-type"].startswith("application/problem+json")
        body = response.json()
        assert body["type"] == "about:blank"
        assert body["title"] == "Internal Server Error"
        assert body["requestId"] == "req-500"
        assert response.headers["x-request-id"] == "req-500"
        assert "secret" not in response.text
        assert "RuntimeError" not in response.text


class TestRequestId:
    def test_request_id_is_echoed(self, client: TestClient) -> None:
        response = client.get("/api/dataset", headers={"X-Request-ID": "abc-123"})
        assert response.headers["x-request-id"] == "abc-123"

    def test_request_id_is_generated_as_a_uuid4_when_absent(self, client: TestClient) -> None:
        first = client.get("/api/dataset").headers["x-request-id"]
        second = client.get("/api/dataset").headers["x-request-id"]
        assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", first)
        assert first != second

    def test_empty_request_id_is_replaced(self, client: TestClient) -> None:
        response = client.get("/api/dataset", headers={"X-Request-ID": ""})
        assert re.fullmatch(r"[0-9a-f-]{36}", response.headers["x-request-id"])

    @settings(max_examples=30)
    @given(st.text(alphabet=st.characters(min_codepoint=33, max_codepoint=126), min_size=1, max_size=64))
    def test_any_printable_request_id_is_echoed_and_matches_the_problem(self, client: TestClient, value: str) -> None:
        ok = client.get("/api/dataset", headers={"X-Request-ID": value})
        assert ok.headers["x-request-id"] == value
        failed = client.get("/api/entries/biosample/SAMN_NONE", headers={"X-Request-ID": value})
        assert failed.headers["x-request-id"] == value
        assert failed.json()["requestId"] == value

    def test_every_kind_of_response_has_the_header(self, client: TestClient) -> None:
        for response in (
            client.get("/api/dataset"),
            client.get("/api/entries/biosample/SAMN_NONE"),
            client.get("/api/nowhere"),
            client.get("/api/entries/biosample", params={"page": 0}),
            client.get("/api/export/accessions/biosample"),
            client.get("/api/export/entries/biosample", params={"format": "ndjson"}),
            client.get("/api/openapi.json"),
            client.post("/api/dsl/serialize", json={}),
        ):
            assert response.headers["x-request-id"], response.url

    def test_generated_request_id_matches_the_problem(self, client: TestClient) -> None:
        response = client.get("/api/entries/biosample/SAMN_NONE")
        assert response.json()["requestId"] == response.headers["x-request-id"]


class TestCors:
    def test_any_origin_is_allowed(self, client: TestClient) -> None:
        response = client.get("/api/dataset", headers={"Origin": "https://example.org"})
        assert response.headers["access-control-allow-origin"] == "*"

    @pytest.mark.parametrize("method", ["GET", "POST", "PUT", "DELETE", "PATCH"])
    def test_preflight_allows_every_method_and_header(self, client: TestClient, method: str) -> None:
        response = client.options(
            "/api/dsl/select",
            headers={
                "Origin": "https://example.org",
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": "x-request-id, content-type, x-anything",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "*"
        assert method in response.headers["access-control-allow-methods"]
        assert "x-anything" in response.headers["access-control-allow-headers"].lower()


class TestServiceInfo:
    def test_reports_store_ok_with_name_version_and_description(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("BSLLMNER_VIEWER_COMMIT", raising=False)
        response = client.get("/api/service-info")
        assert response.status_code == 200
        body = response.json()
        assert set(body) == {"name", "version", "description", "store"}
        assert body["store"] == "ok"
        assert body["version"] == __version__
        assert body["name"]
        assert body["description"]

    def test_version_has_the_commit_suffix_when_the_variable_is_set(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("BSLLMNER_VIEWER_COMMIT", "20545b4")
        assert client.get("/api/service-info").json()["version"] == f"{__version__}+20545b4"

    def test_version_has_no_suffix_when_the_variable_is_empty(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("BSLLMNER_VIEWER_COMMIT", "")
        assert client.get("/api/service-info").json()["version"] == __version__

    def test_store_is_unavailable_with_status_200_when_the_store_cannot_be_queried(
        self, isolated_client: TestClient
    ) -> None:
        isolated_client.app.state.store.close()  # type: ignore[attr-defined]
        response = isolated_client.get("/api/service-info")
        assert response.status_code == 200
        assert response.json()["store"] == "unavailable"
        assert response.headers["x-request-id"]
        isolated_client.app.state.store._con = duckdb.connect(":memory:")  # type: ignore[attr-defined]


@pytest.fixture(scope="module")
def spec(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    body: dict[str, Any] = response.json()
    return body


class TestOpenApi:
    EXPECTED_OPERATIONS = {
        ("GET", "/api/dataset"): "getDataset",
        ("GET", "/api/service-info"): "getServiceInfo",
        ("GET", "/api/dsl/parse"): "parseCondition",
        ("POST", "/api/dsl/serialize"): "serializeCondition",
        ("POST", "/api/dsl/select"): "selectElement",
        ("GET", "/api/entries/{type}"): "listEntries",
        ("GET", "/api/entries/biosample/{accession}"): "getEntry",
        ("GET", "/api/distribution"): "getDistribution",
        ("GET", "/api/crosstab"): "getCrosstab",
        ("GET", "/api/trend"): "getTrend",
        ("GET", "/api/projects"): "listProjects",
        ("GET", "/api/terms"): "searchTerms",
        ("GET", "/api/terms/children"): "listTermChildren",
        ("GET", "/api/export/entries/{type}"): "exportEntries",
        ("GET", "/api/export/accessions/{type}"): "exportAccessions",
    }

    def test_paths_and_operation_ids(self, spec: dict[str, Any]) -> None:
        found = {
            (method.upper(), path): operation["operationId"]
            for path, item in spec["paths"].items()
            for method, operation in item.items()
        }
        assert found == self.EXPECTED_OPERATIONS

    def test_paths_start_with_api_and_have_no_trailing_slash(self, spec: dict[str, Any]) -> None:
        assert all(p.startswith("/api/") and not p.endswith("/") for p in spec["paths"])

    def test_info(self, spec: dict[str, Any]) -> None:
        assert spec["info"]["version"] == API_VERSION == "0.1.0"
        assert spec["info"]["contact"] == {
            "name": "BioData Science Initiative",
            "url": "https://github.com/dbcls/bsllmner-viewer",
        }
        assert spec["info"]["license"] == {"name": "Apache-2.0", "url": "https://www.apache.org/licenses/LICENSE-2.0"}

    def test_tags_have_descriptions_in_title_case(self, spec: dict[str, Any]) -> None:
        tags = {t["name"]: t["description"] for t in spec["tags"]}
        assert set(tags) == {
            "Entries",
            "Aggregations",
            "Condition",
            "Projects",
            "Terms",
            "Export",
            "Dataset",
            "Service Info",
        }
        assert all(tags.values())
        used = {tag for item in spec["paths"].values() for op in item.values() for tag in op["tags"]}
        assert used == set(tags)

    def test_default_validation_schemas_are_removed(self, spec: dict[str, Any]) -> None:
        assert "HTTPValidationError" not in spec["components"]["schemas"]
        assert "ValidationError" not in spec["components"]["schemas"]
        assert "HTTPValidationError" not in orjson.dumps(spec).decode()
        assert "ProblemDetails" in spec["components"]["schemas"]

    def test_error_responses_are_problem_json(self, spec: dict[str, Any]) -> None:
        for path, item in spec["paths"].items():
            for method, operation in item.items():
                errors = {code: r for code, r in operation["responses"].items() if code[0] in "45"}
                assert {"400", "422", "500"} <= set(errors), (method, path)
                for code, response in errors.items():
                    assert list(response["content"]) == ["application/problem+json"], (method, path, code)
                    ref = response["content"]["application/problem+json"]["schema"]["$ref"]
                    assert ref == "#/components/schemas/ProblemDetails"

    def test_routes_with_a_type_or_accession_document_not_found(self, spec: dict[str, Any]) -> None:
        for path in (
            "/api/entries/{type}",
            "/api/entries/biosample/{accession}",
            "/api/export/entries/{type}",
            "/api/export/accessions/{type}",
        ):
            assert "404" in spec["paths"][path]["get"]["responses"], path

    def test_names_are_camel_case(self, spec: dict[str, Any]) -> None:
        for path, item in spec["paths"].items():
            for operation in item.values():
                for parameter in operation.get("parameters", []):
                    assert "_" not in parameter["name"], (path, parameter["name"])
        for name, schema in spec["components"]["schemas"].items():
            assert all("_" not in prop for prop in schema.get("properties", {})), name

    def test_type_parameters_list_the_entry_types(self, spec: dict[str, Any]) -> None:
        def values(path: str) -> list[str]:
            parameter = next(p for p in spec["paths"][path]["get"]["parameters"] if p["name"] == "type")
            schema = parameter["schema"]
            if "$ref" in schema:
                schema = spec["components"]["schemas"][schema["$ref"].rsplit("/", 1)[1]]
            return list(schema["enum"])

        assert values("/api/entries/{type}") == ["biosample", "sra-experiment"]
        assert values("/api/export/entries/{type}") == ["biosample", "sra-experiment"]
        assert values("/api/export/accessions/{type}") == ["biosample", "sra-experiment", "sra-run", "bioproject"]

    def test_self_exclusion_parameter_is_named_facet_self_exclude_with_default_false(
        self, spec: dict[str, Any]
    ) -> None:
        for path in ("/api/distribution", "/api/crosstab", "/api/trend", "/api/projects", "/api/terms"):
            parameter = next(p for p in spec["paths"][path]["get"]["parameters"] if p["name"] == "facetSelfExclude")
            assert parameter["schema"]["default"] is False, path

    def test_documentation_pages(self, client: TestClient) -> None:
        assert client.get("/api").status_code == 200
        assert "swagger" in client.get("/api").text.lower()
        assert client.get("/api/redoc").status_code == 200
        assert client.get("/api/docs").status_code == 404


class TestExport:
    def test_ndjson_media_type_and_keys_match_the_entry_items(self, client: TestClient) -> None:
        response = client.get("/api/export/entries/biosample", params={"format": "ndjson"})
        assert response.headers["content-type"].split(";")[0] == "application/x-ndjson"
        first = orjson.loads(response.text.splitlines()[0])
        item = _first(client, "/api/entries/biosample", perPage="1")["items"][0]
        assert set(first) == set(item)
        assert first == item
        assert _snake_case_keys(first) == []

    def test_tsv_media_type_and_camel_case_header(self, client: TestClient) -> None:
        response = client.get("/api/export/entries/sra-experiment")
        assert response.headers["content-type"].startswith("text/tab-separated-values")
        header = response.text.splitlines()[0].split("\t")
        assert header[:11] == [
            "identifier",
            "type",
            "biosample",
            "experiments",
            "title",
            "organismIdentifier",
            "organismName",
            "libraryStrategy",
            "bioprojects",
            "dateCreated",
            "chipAtlas",
        ]
        assert header[11:] == ["cell_line", "disease", "tissue", "drug", "chip_antigen"]

    def test_default_format_is_tsv(self, client: TestClient) -> None:
        assert client.get("/api/export/entries/biosample").headers["content-type"].startswith("text/tab-separated")

    @pytest.mark.parametrize("kind", ["biosample", "sra-experiment"])
    def test_ndjson_line_count_equals_the_total(self, client: TestClient, kind: str) -> None:
        total = _first(client, f"/api/entries/{kind}", perPage="1")["pagination"]["total"]
        text = client.get(f"/api/export/entries/{kind}", params={"format": "ndjson"}).text
        assert len(text.splitlines()) == total

    def test_accession_export_for_a_condition(self, client: TestClient) -> None:
        q = "library_strategy:RNA-Seq"
        lines = client.get("/api/export/accessions/bioproject", params={"q": q}).text.splitlines()
        assert lines[0].startswith("# bsllmner-viewer bioproject accessions")
        assert q in lines[0]
        assert len(lines) - 1 == _first(client, "/api/projects", q=q)["pagination"]["total"]
