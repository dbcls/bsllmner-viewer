"""Requests that reach the edges of the API: huge pages, failures, header lines, and malformed elements."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hypothesis import assume, given
from hypothesis import strategies as st

from bsllmner_viewer.api.app import create_app

PROBLEM_PREFIX = "https://ddbj.nig.ac.jp/problems/"
ACCESSION = re.compile(r"^[A-Z]+[0-9]+$")


@pytest.fixture
def isolated_client(store_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(store_path), raise_server_exceptions=False) as client:
        yield client


class TestHugePages:
    @pytest.mark.parametrize("page", [2**31, 2**63 - 1, 2**63, 10**20, 2**80])
    @pytest.mark.parametrize("path", ["/api/entries/biosample", "/api/projects"])
    def test_page_past_the_last_row_returns_an_empty_list(self, client: TestClient, path: str, page: int) -> None:
        response = client.get(path, params={"page": page, "perPage": 100})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["items"] == []
        assert body["pagination"]["hasNext"] is False
        assert body["pagination"]["page"] == page

    @given(st.integers(min_value=1, max_value=2**80), st.integers(min_value=1, max_value=100))
    def test_any_page_and_per_page_never_fail(self, client: TestClient, page: int, per_page: int) -> None:
        for path in ("/api/entries/biosample", "/api/projects"):
            response = client.get(path, params={"page": page, "perPage": per_page})
            assert response.status_code == 200, (path, page, per_page, response.text)
            body = response.json()
            pagination = body["pagination"]
            offset = (page - 1) * per_page
            assert pagination["hasNext"] == (page * per_page < pagination["total"])
            assert (len(body["items"]) > 0) == (offset < pagination["total"])

    def test_last_page_is_not_empty_and_the_page_after_it_is(self, client: TestClient) -> None:
        total = client.get("/api/entries/biosample", params={"perPage": 1}).json()["pagination"]["total"]
        last = client.get("/api/entries/biosample", params={"perPage": 1, "page": total}).json()
        assert len(last["items"]) == 1
        beyond = client.get("/api/entries/biosample", params={"perPage": 1, "page": total + 1}).json()
        assert beyond["items"] == []


class TestUnhandledErrorHeaders:
    def test_unhandled_exception_response_has_the_cors_headers(self, isolated_client: TestClient) -> None:
        def boom() -> None:
            raise RuntimeError("secret internal detail")

        isolated_client.app.add_api_route("/api/boom", boom)  # type: ignore[attr-defined]
        origin = {"Origin": "http://other.example", "X-Request-ID": "req-cors"}
        failed = isolated_client.get("/api/boom", headers=origin)
        assert failed.status_code == 500
        assert failed.headers["access-control-allow-origin"] == "*"
        assert failed.headers["x-request-id"] == "req-cors"
        assert failed.json()["requestId"] == "req-cors"
        assert failed.headers["content-type"].startswith("application/problem+json")
        ok = isolated_client.get("/api/dataset", headers=origin)
        assert ok.headers["access-control-allow-origin"] == "*"

    def test_unhandled_exception_without_origin_has_no_cors_header(self, isolated_client: TestClient) -> None:
        def boom() -> None:
            raise RuntimeError("x")

        isolated_client.app.add_api_route("/api/boom", boom)  # type: ignore[attr-defined]
        failed = isolated_client.get("/api/boom")
        assert failed.status_code == 500
        assert "access-control-allow-origin" not in failed.headers


_LINE_BREAKS = ["\n", "\r", "\r\n", "\x0b", "\x0c", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029"]
_phrase_text = st.lists(
    st.one_of(st.sampled_from(_LINE_BREAKS), st.characters(exclude_categories=["Cs"])), max_size=20
).map("".join)


def _phrase(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


class TestAccessionListHeader:
    @given(_phrase_text, st.sampled_from(["keyword", "field"]))
    def test_header_stays_on_one_line_and_every_other_line_is_an_accession(
        self, client: TestClient, text: str, where: str
    ) -> None:
        phrase = _phrase("a" + text)
        q = phrase if where == "keyword" else f"disease:{phrase}"
        response = client.get("/api/export/accessions/biosample", params={"q": q})
        assume(response.status_code == 200)
        lines = response.text.splitlines()
        assert lines[0].startswith("# bsllmner-viewer biosample accessions; q=")
        assert all(not line.startswith("#") for line in lines[1:])
        assert all(ACCESSION.match(line) for line in lines[1:]), lines
        total = client.get("/api/entries/biosample", params={"q": q, "perPage": 1}).json()["pagination"]["total"]
        assert len(lines) == total + 1

    def test_header_writes_the_condition_as_a_json_string(self, client: TestClient) -> None:
        q = '"a\nb" AND library_strategy:RNA-Seq'
        header = client.get("/api/export/accessions/biosample", params={"q": q}).text.splitlines()[0]
        assert re.fullmatch(
            r'# bsllmner-viewer biosample accessions; q="\\"a\\nb\\" AND library_strategy:RNA-Seq"; '
            r"dataset=\S+ \S+ \S+",
            header,
        ), header

    def test_header_of_an_empty_condition_is_an_empty_json_string(self, client: TestClient) -> None:
        header = client.get("/api/export/accessions/biosample").text.splitlines()[0]
        assert '; q=""; dataset=' in header


_BAD_NUMBERS = ["09606", "+9606", "-1", "\uff19\uff16\uff10\uff16", "1e3", "0x10", "2147483648", "9" * 30]


class TestElementNumbers:
    @pytest.mark.parametrize("bad", _BAD_NUMBERS)
    @pytest.mark.parametrize("path", ["/api/distribution", "/api/trend"])
    def test_organism_element_that_is_not_canonical_is_rejected(self, client: TestClient, path: str, bad: str) -> None:
        response = client.get(path, params={"field": "organism_id", "elements": f"9606,{bad}"})
        assert response.status_code == 400, (bad, response.text)
        assert response.json()["type"] == PROBLEM_PREFIX + "invalid-element"

    @pytest.mark.parametrize("bad", ["09606", "+9606", "\uff19\uff16\uff10\uff16", "9" * 30, "2147483648"])
    def test_organism_element_of_a_crosstab_axis_is_rejected(self, client: TestClient, bad: str) -> None:
        for params in (
            {"row": "organism_id", "col": "library_strategy", "rowElements": bad},
            {"row": "library_strategy", "col": "organism_id", "colElements": bad},
        ):
            response = client.get("/api/crosstab", params=params)
            assert response.status_code == 400, (params, response.text)
            assert response.json()["type"] == PROBLEM_PREFIX + "invalid-element"

    @pytest.mark.parametrize("bad", ["02020", "+2020", "\uff12\uff10\uff12\uff10", "999", "10000", "-2020", "9" * 30])
    def test_year_element_that_is_not_canonical_is_rejected(self, client: TestClient, bad: str) -> None:
        response = client.get("/api/distribution", params={"field": "date_published", "elements": bad})
        assert response.status_code == 400, (bad, response.text)
        assert response.json()["type"] == PROBLEM_PREFIX + "invalid-element"

    def test_canonical_organism_and_year_elements_are_accepted(self, client: TestClient) -> None:
        organisms = client.get("/api/distribution", params={"field": "organism_id", "elements": "9606,10090"})
        assert organisms.status_code == 200
        assert {e["value"] for e in organisms.json()["elements"]} == {"9606", "10090"}
        years = client.get("/api/distribution", params={"field": "date_published", "elements": "1000,2020,9999"})
        assert years.status_code == 200
        assert {e["value"] for e in years.json()["elements"]} == {"1000", "2020", "9999"}

    @given(st.text(max_size=12))
    def test_any_organism_or_year_element_gives_200_or_400(self, client: TestClient, text: str) -> None:
        assume("," not in text)
        for field in ("organism_id", "date_published"):
            response = client.get("/api/distribution", params={"field": field, "elements": text})
            assert response.status_code in (200, 400), (field, text, response.text)
            if response.status_code == 400:
                assert response.json()["type"] == PROBLEM_PREFIX + "invalid-element"


class TestMethodNotAllowed:
    @pytest.mark.parametrize("path", ["/api/dataset", "/api/entries/biosample", "/api/distribution"])
    def test_405_response_has_an_allow_header_that_lists_get(self, client: TestClient, path: str) -> None:
        response = client.post(path)
        assert response.status_code == 405
        assert "GET" in {m.strip() for m in response.headers["allow"].split(",")}
        assert response.headers["x-request-id"]
        assert response.json()["status"] == 405


class TestNamedElementValues:
    @pytest.mark.parametrize("bad", ["brain", "UBERON", "UBERON:", ":0000955", "UBERON: 1"])
    def test_term_element_that_is_not_a_term_id_is_rejected(self, client: TestClient, bad: str) -> None:
        for path, params in (
            ("/api/distribution", {"field": "tissue", "elements": bad}),
            ("/api/trend", {"field": "tissue", "elements": bad}),
            ("/api/crosstab", {"row": "tissue", "col": "library_strategy", "rowElements": bad}),
            ("/api/crosstab", {"row": "library_strategy", "col": "tissue", "colElements": bad}),
        ):
            response = client.get(path, params=params)
            assert response.status_code == 400, (path, params, response.text)
            body = response.json()
            assert body["type"] == PROBLEM_PREFIX + "invalid-element"
            assert "PREFIX:ID" in body["detail"]

    @pytest.mark.parametrize("bad", ["WGS", "rna-seq", "RNA-seq", "ChIP"])
    def test_assay_element_that_is_not_a_target_assay_is_rejected(self, client: TestClient, bad: str) -> None:
        for path, params in (
            ("/api/distribution", {"field": "library_strategy", "elements": f"RNA-Seq,{bad}"}),
            ("/api/trend", {"field": "library_strategy", "elements": bad}),
            ("/api/crosstab", {"row": "library_strategy", "col": "tissue", "rowElements": bad}),
        ):
            response = client.get(path, params=params)
            assert response.status_code == 400, (path, params, response.text)
            body = response.json()
            assert body["type"] == PROBLEM_PREFIX + "invalid-element"
            assert "RNA-Seq" in body["detail"]

    def test_term_and_assay_elements_of_the_right_form_are_accepted(self, client: TestClient) -> None:
        terms = client.get("/api/distribution", params={"field": "tissue", "elements": "UBERON:9999999"})
        assert terms.status_code == 200
        assays = client.get("/api/distribution", params={"field": "library_strategy", "elements": "RNA-Seq"})
        assert assays.status_code == 200

    @given(st.text(max_size=12))
    def test_an_element_gives_400_exactly_when_its_clause_gives_400(self, client: TestClient, text: str) -> None:
        assume("," not in text and text.strip() == text and text)
        for field in ("tissue", "library_strategy"):
            element = client.get("/api/distribution", params={"field": field, "elements": text})
            assert element.status_code in (200, 400), (field, text, element.text)
            clause = client.post("/api/dsl/select", json={"clauses": [{"field": field, "value": text}]})
            assert clause.status_code in (200, 400), (field, text, clause.text)
            assert element.status_code == clause.status_code, (field, text, element.text, clause.text)
