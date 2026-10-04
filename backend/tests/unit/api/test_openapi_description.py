"""The OpenAPI document describes every operation, parameter, and error slug.

The headings that the descriptions cite exist in the docs.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.api.problems import AGGREGATION_SLUGS, BUSY_SLUGS, DSL_SLUGS, SLUG_INFO

# The docs directory is `docs/` of the repository, or `/docs` in the container where `/app` is `backend/`.
DOCS = Path(__file__).resolve().parents[4] / "docs"
# The OpenAPI document that the frontend generates its API types from.
OPENAPI_FILE = Path(__file__).resolve().parents[3] / "openapi.json"
EXPORT_COMMAND = "docker compose run --rm --no-deps -T api uv run python scripts/export_openapi.py"
HTTP_METHODS = ("get", "post", "put", "patch", "delete")
SLUG_LINE = re.compile(r"^- `([a-z-]+)`: ", re.MULTILINE)
CITED_HEADINGS = re.compile(r'((?:"[^"]+"(?:,| and)? ?)+) in /llms-full\.txt')


@pytest.fixture(scope="module")
def document(client: TestClient) -> dict[str, Any]:
    body: dict[str, Any] = client.get("/api/openapi.json").json()
    return body


def _operations(document: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    return [
        (f"{method.upper()} {path}", operation)
        for path, item in document["paths"].items()
        for method, operation in item.items()
        if method in HTTP_METHODS
    ]


def _descriptions(node: Any) -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "description" and isinstance(value, str):
                found.append(value)
            else:
                found.extend(_descriptions(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_descriptions(item))
    return found


class TestOpenApiFile:
    def test_the_openapi_file_is_the_document_that_the_api_serves(self, document: dict[str, Any]) -> None:
        assert OPENAPI_FILE.is_file(), f"backend/openapi.json is missing. Write it with: {EXPORT_COMMAND}"
        written = json.loads(OPENAPI_FILE.read_text(encoding="utf-8"))
        assert written == document, f"backend/openapi.json differs from the api. Write it again with: {EXPORT_COMMAND}"


class TestEnumSchemas:
    def test_entry_type_and_accession_type_schemas_list_the_documented_names(self, document: dict[str, Any]) -> None:
        schemas = document["components"]["schemas"]
        entry = schemas["EntryType"]
        accession = schemas["AccessionType"]
        assert (entry.get("enum") or [entry.get("const")]) == ["biosample"]
        assert set(accession["enum"]) == {"biosample", "sra-experiment", "sra-run", "bioproject"}
        assert len(accession["enum"]) == 4


class TestOperations:
    def test_every_operation_has_a_summary_and_a_description(self, document: dict[str, Any]) -> None:
        operations = _operations(document)
        assert len(operations) >= 16
        for name, operation in operations:
            assert operation.get("summary", "").strip(), name
            assert operation.get("description", "").strip(), name

    def test_every_parameter_has_a_description(self, document: dict[str, Any]) -> None:
        for name, operation in _operations(document):
            for parameter in operation.get("parameters", []):
                assert parameter.get("description", "").strip(), f"{name} {parameter['name']}"

    def test_every_operation_has_a_declared_tag(self, document: dict[str, Any]) -> None:
        declared = {tag["name"] for tag in document["tags"]}
        for name, operation in _operations(document):
            assert operation["tags"], name
            assert set(operation["tags"]) <= declared, name

    def test_the_entry_and_aggregation_tags_name_the_units(self, document: dict[str, Any]) -> None:
        tags = {tag["name"]: tag["description"] for tag in document["tags"]}
        assert "SRA" not in tags["Entries"]
        for unit in ("BioSamples", "SRA Experiments", "BioProjects"):
            assert unit in tags["Aggregations"]

    def test_the_export_responses_declare_their_media_types(self, document: dict[str, Any]) -> None:
        accessions = document["paths"]["/api/export/accessions/{type}"]["get"]["responses"]["200"]["content"]
        entries = document["paths"]["/api/export/entries/{type}"]["get"]["responses"]["200"]["content"]
        assert set(accessions) == {"text/plain"}
        assert set(entries) == {"text/tab-separated-values", "application/x-ndjson"}


class TestErrorSlugs:
    def test_every_slug_in_a_400_or_503_description_has_its_cause_and_its_remedy(
        self, document: dict[str, Any]
    ) -> None:
        listed = 0
        for name, operation in _operations(document):
            for status in ("400", "503"):
                response = operation["responses"].get(status)
                if response is None:
                    continue
                description = response["description"]
                slugs = SLUG_LINE.findall(description)
                assert slugs, f"{name} {status}"
                for slug in slugs:
                    assert slug in SLUG_INFO, f"{name} {slug}"
                    assert SLUG_INFO[slug].cause in description, f"{name} {slug}"
                    assert SLUG_INFO[slug].remedy in description, f"{name} {slug}"
                    listed += 1
        assert listed > 0

    def test_every_operation_that_can_be_busy_lists_the_three_503_slugs(self, document: dict[str, Any]) -> None:
        for name, operation in _operations(document):
            response = operation["responses"].get("503")
            if response is not None:
                assert tuple(SLUG_LINE.findall(response["description"])) == BUSY_SLUGS, name

    def test_every_slug_of_the_table_is_listed_by_some_operation(self, document: dict[str, Any]) -> None:
        used = {
            slug
            for _, operation in _operations(document)
            for status in ("400", "503")
            if status in operation["responses"]
            for slug in SLUG_LINE.findall(operation["responses"][status]["description"])
        }
        assert used == set(SLUG_INFO)

    def test_the_slug_groups_are_in_the_table(self) -> None:
        assert set(DSL_SLUGS) | set(AGGREGATION_SLUGS) | set(BUSY_SLUGS) <= set(SLUG_INFO)

    @pytest.mark.parametrize("slug", sorted(SLUG_INFO))
    def test_a_slug_description_is_one_line_so_that_it_stays_one_list_item(self, slug: str) -> None:
        assert "\n" not in SLUG_INFO[slug].cause + SLUG_INFO[slug].remedy


class TestInfo:
    def test_the_description_links_the_llms_files_with_relative_urls(self, document: dict[str, Any]) -> None:
        description = document["info"]["description"]
        assert "](/llms.txt)" in description
        assert "](/llms-full.txt)" in description

    def test_the_description_names_the_caching_rules_that_the_responses_follow(self, document: dict[str, Any]) -> None:
        description = document["info"]["description"]
        assert "`ETag`" in description
        assert "`If-None-Match`" in description


class TestStatusIsNotADimension:
    def test_no_description_offers_a_status_field_as_a_dimension_or_a_single_status_as_a_value(
        self, document: dict[str, Any]
    ) -> None:
        for description in _descriptions(document):
            assert "_status` distribution" not in description
            assert "mapped_exact:" not in description


@pytest.mark.skipif(not DOCS.is_dir(), reason="the docs directory is not mounted")
class TestCitedHeadings:
    def test_every_heading_that_a_description_cites_exists_in_the_docs(self, document: dict[str, Any]) -> None:
        headings = {
            line.lstrip("#").strip()
            for name in ("api.md", "data-model.md")
            for line in (DOCS / name).read_text(encoding="utf-8").splitlines()
            if line.startswith("#")
        }
        cited: set[str] = set()
        for description in _descriptions(document):
            for group in CITED_HEADINGS.findall(description):
                cited.update(re.findall(r'"([^"]+)"', group))
        assert cited
        assert cited <= headings, cited - headings
