"""Which status each kind of bad request gets: 422 for a request that breaks the OpenAPI document, 400 for the rest."""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.api.app import create_app

PROBLEM_PREFIX = "https://ddbj.nig.ac.jp/problems/"


@pytest.fixture
def isolated_client(store_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(store_path), raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def copied_client(store_path: Path, tmp_path: Path) -> Iterator[tuple[TestClient, Path]]:
    copy = tmp_path / "copy.duckdb"
    shutil.copy(store_path, copy)
    with TestClient(create_app(copy), raise_server_exceptions=False) as client:
        yield client, copy


class TestBodyErrors:
    def test_a_body_with_an_unknown_key_is_unprocessable_for_both_operations(self, client: TestClient) -> None:
        for path, body in (
            ("/api/dsl/keyword", {"keyword": "a", "zzz": 1}),
            ("/api/dsl/select", {"clauses": [{"field": "disease", "value": "x"}], "zzz": 1}),
        ):
            response = client.post(path, json=body)
            assert response.status_code == 422, path
            assert response.json()["type"] == "about:blank"

    @pytest.mark.parametrize(
        ("clause", "slug"),
        [
            ({"field": "nofield", "value": "x"}, "unknown-field"),
            ({"field": "organism_id", "value": "abc"}, "invalid-value"),
            ({"field": "disease_status", "value": "zzz"}, "invalid-value"),
            ({"field": "disease", "value": ""}, "missing-value"),
            ({"field": "date_published", "value": "x"}, "invalid-operator-for-field"),
            ({"field": "disease", "from": "2020-01-01"}, "invalid-ast"),
        ],
    )
    def test_select_clause_of_a_wrong_field_or_value_has_the_slug_that_the_condition_would_have(
        self, client: TestClient, clause: dict[str, str], slug: str
    ) -> None:
        response = client.post("/api/dsl/select", json={"clauses": [clause]})
        assert response.status_code == 400
        assert response.json()["type"] == PROBLEM_PREFIX + slug
        if slug != "invalid-ast":
            piece = f"{clause['field']}:{clause['value']}" if clause["value"] else f'{clause["field"]}:""'
            parsed = client.get("/api/dsl/parse", params={"q": piece})
            assert parsed.json()["type"] == response.json()["type"]


class TestDimensions:
    @pytest.mark.parametrize(
        ("path", "params"),
        [
            ("/api/distribution", {"field": "nofield"}),
            ("/api/distribution", {"field": "Disease"}),
            ("/api/crosstab", {"row": "nofield", "col": "disease"}),
            ("/api/crosstab", {"row": "disease", "col": "nofield"}),
            ("/api/trend", {"field": "nofield"}),
            ("/api/terms", {"field": "nofield"}),
            ("/api/terms/children", {"field": "nofield", "termId": "x"}),
        ],
    )
    def test_a_field_that_the_dataset_does_not_have_is_an_unknown_field(
        self, client: TestClient, path: str, params: dict[str, str]
    ) -> None:
        response = client.get(path, params=params)
        assert response.status_code == 400
        body = response.json()
        assert body["type"] == PROBLEM_PREFIX + "unknown-field"
        assert "disease" in body["detail"]

    @pytest.mark.parametrize(
        ("path", "params"),
        [
            ("/api/distribution", {"field": "bioproject"}),
            ("/api/crosstab", {"row": "bioproject", "col": "disease"}),
            ("/api/trend", {"field": "bioproject"}),
            ("/api/trend", {"field": "date_published"}),
            ("/api/terms", {"field": "organism_id"}),
            ("/api/terms", {"field": "disease_status"}),
            ("/api/terms/children", {"field": "library_strategy", "termId": "x"}),
            ("/api/crosstab", {"row": "disease", "col": "disease"}),
        ],
    )
    def test_a_field_that_cannot_be_a_dimension_is_an_invalid_dimension(
        self, client: TestClient, path: str, params: dict[str, str]
    ) -> None:
        response = client.get(path, params=params)
        assert response.status_code == 400
        assert response.json()["type"] == PROBLEM_PREFIX + "invalid-dimension"


class TestTermChildren:
    def test_a_term_that_the_dataset_does_not_have_is_not_found(self, client: TestClient) -> None:
        for term_id in ("NOPE:1", ""):
            response = client.get("/api/terms/children", params={"field": "disease", "termId": term_id})
            assert response.status_code == 404, term_id
            assert response.json()["type"] == "about:blank"

    def test_a_term_of_the_dataset_without_children_has_an_empty_list(self, client: TestClient) -> None:
        elements = client.get("/api/distribution", params={"field": "disease", "limit": 50}).json()["elements"]
        leaves = [e["value"] for e in elements if not e["hasChildren"]]
        assert leaves
        response = client.get("/api/terms/children", params={"field": "disease", "termId": leaves[0]})
        assert response.status_code == 200
        assert response.json()["children"] == []


class TestUnknownQueryParameters:
    @pytest.mark.parametrize(
        ("path", "name"),
        [
            ("/api/entries/biosample", "sort"),
            ("/api/entries/biosample", "query"),
            ("/api/distribution", "facetselfexclude"),
            ("/api/service-info", "foo"),
            ("/api/dataset", "q"),
            ("/api/entries/biosample/SAMN1", "q"),
            ("/api/terms/MONDO:1", "q"),
            ("/api/export/entries/biosample", "perPage"),
        ],
    )
    def test_an_undeclared_parameter_is_unprocessable_and_named(self, client: TestClient, path: str, name: str) -> None:
        response = client.get(path, params={name: "1"})
        assert response.status_code == 422
        body = response.json()
        assert body["type"] == "about:blank"
        assert name in body["detail"]

    def test_the_detail_lists_the_accepted_parameters(self, client: TestClient) -> None:
        detail = client.get("/api/entries/biosample", params={"zzz": "1"}).json()["detail"]
        for name in ("q", "page", "perPage"):
            assert name in detail

    def test_a_repeated_declared_parameter_is_accepted(self, client: TestClient) -> None:
        assert client.get("/api/entries/biosample", params=[("q", ""), ("q", "")]).status_code == 200


class TestReversedDateRange:
    def test_a_reversed_range_matches_nothing(self, client: TestClient) -> None:
        q = "date_published:[2020-12-31 TO 2015-01-01]"
        response = client.get("/api/entries/biosample", params={"q": q})
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 0

    def test_the_negation_of_a_reversed_range_matches_everything(self, client: TestClient) -> None:
        everything = client.get("/api/entries/biosample").json()["pagination"]["total"]
        q = "NOT date_published:[2020-12-31 TO 2015-01-01]"
        assert client.get("/api/entries/biosample", params={"q": q}).json()["pagination"]["total"] == everything

    def test_a_reversed_range_is_a_valid_clause_to_select(self, client: TestClient) -> None:
        clause = {"field": "date_published", "from": "2020-12-31", "to": "2015-01-01"}
        assert client.post("/api/dsl/select", json={"clauses": [clause]}).status_code == 200


class TestServiceInfoAfterTheStoreFileChanges:
    def test_the_store_is_ok_while_the_file_is_unchanged(self, copied_client: tuple[TestClient, Path]) -> None:
        client, _ = copied_client
        assert client.get("/api/service-info").json()["store"] == "ok"

    def test_the_store_is_unavailable_after_the_file_is_truncated(self, copied_client: tuple[TestClient, Path]) -> None:
        client, copy = copied_client
        assert client.get("/api/service-info").json()["store"] == "ok"
        with copy.open("r+b") as f:
            f.truncate(copy.stat().st_size // 2)
        response = client.get("/api/service-info")
        assert response.status_code == 200
        assert response.json()["store"] == "unavailable"

    def test_the_store_is_unavailable_after_the_file_is_overwritten_in_place(
        self, copied_client: tuple[TestClient, Path]
    ) -> None:
        client, copy = copied_client
        with copy.open("r+b") as f:
            f.seek(0)
            f.write(f.read(16))
        assert client.get("/api/service-info").json()["store"] == "unavailable"

    def test_the_store_stays_ok_when_the_file_is_deleted_or_replaced(
        self, copied_client: tuple[TestClient, Path], tmp_path: Path
    ) -> None:
        client, copy = copied_client
        replacement = tmp_path / "replacement.duckdb"
        replacement.write_bytes(b"x")
        replacement.replace(copy)
        assert client.get("/api/service-info").json()["store"] == "ok"
        copy.unlink()
        assert client.get("/api/service-info").json()["store"] == "ok"


@pytest.fixture(scope="module")
def operations(client: TestClient) -> dict[str, dict[str, Any]]:
    spec = client.get("/api/openapi.json").json()
    return {op["operationId"]: op["responses"] for item in spec["paths"].values() for op in item.values()}


class TestOpenApiErrorDeclarations:
    def test_operations_without_a_condition_or_a_dimension_declare_no_400(
        self, operations: dict[str, dict[str, Any]]
    ) -> None:
        for name in ("getDataset", "getServiceInfo", "getEntry", "getTerm"):
            assert "400" not in operations[name], name

    def test_operations_with_a_condition_declare_the_slugs_of_their_400(
        self, operations: dict[str, dict[str, Any]]
    ) -> None:
        for name in ("listEntries", "getDistribution", "getCrosstab", "getTrend", "listProjects", "searchTerms"):
            assert "`unexpected-token`" in operations[name]["400"]["description"], name
        assert "`invalid-ast`" in operations["selectElement"]["400"]["description"]
        assert "`too-many-elements`" in operations["getDistribution"]["400"]["description"]

    def test_operations_with_a_path_parameter_declare_404(self, operations: dict[str, dict[str, Any]]) -> None:
        for name in ("listEntries", "getEntry", "getTerm", "listTermChildren", "exportEntries", "exportAccessions"):
            assert "404" in operations[name], name
        for name in ("getDataset", "getDistribution", "listProjects"):
            assert "404" not in operations[name], name

    def test_operations_that_wait_for_a_slot_declare_503(self, operations: dict[str, dict[str, Any]]) -> None:
        for name in ("listEntries", "getDistribution", "getCrosstab", "getTrend", "listProjects", "searchTerms"):
            assert "`query-timeout`" in operations[name]["503"]["description"], name
        for name in ("exportEntries", "exportAccessions", "listTermChildren"):
            assert "503" in operations[name], name
        for name in ("getDataset", "getServiceInfo", "getEntry", "parseCondition"):
            assert "503" not in operations[name], name
