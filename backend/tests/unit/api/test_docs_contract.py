"""The docs, `/llms.txt`, and the code agree on the numbers and the names that clients rely on."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.api.problems import SLUG_INFO
from bsllmner_viewer.api.schemas import ACCESSION_MAX_LENGTH, MAX_ELEMENTS, NAME_MAX_LENGTH
from bsllmner_viewer.dsl.parser import MAX_LENGTH
from bsllmner_viewer.dsl.validator import MAX_DEPTH, MAX_KEYWORD_WORDS, MAX_KEYWORDS, MAX_NODES

# The repository root, or `/` in the container where `/app` is `backend/` and `docs/` and `frontend/public/` are
# mounted at `/docs` and `/frontend/public`.
ROOT = Path(__file__).resolve().parents[4]
API_MD = ROOT / "docs" / "api.md"
DATA_MODEL_MD = ROOT / "docs" / "data-model.md"
LLMS_TXT = ROOT / "frontend" / "public" / "llms.txt"
HTTP_METHODS = ("get", "post", "put", "patch", "delete")
# Paths that the document of operations does not list.
UNLISTED_PATHS = {"/api", "/api/openapi.json"}

needs_docs = pytest.mark.skipif(
    not (API_MD.is_file() and DATA_MODEL_MD.is_file() and LLMS_TXT.is_file()),
    reason="docs/ and frontend/public/ are not available",
)


@pytest.fixture(scope="module")
def document(client: TestClient) -> dict[str, Any]:
    body: dict[str, Any] = client.get("/api/openapi.json").json()
    return body


@pytest.fixture(scope="module")
def api_md() -> str:
    return API_MD.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def llms() -> str:
    return LLMS_TXT.read_text(encoding="utf-8")


def _headings(*paths: Path) -> set[str]:
    return {
        line.lstrip("#").strip()
        for path in paths
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.startswith("#")
    }


@needs_docs
class TestLimitsInTheDocs:
    def test_the_condition_limits_of_the_docs_are_the_constants_of_the_code(self, api_md: str) -> None:
        assert f"nests groups at most {MAX_DEPTH} levels deep and has at most {MAX_NODES} nodes" in api_md

    def test_the_length_limits_of_the_docs_are_the_constants_of_the_code(self, api_md: str) -> None:
        assert f"have at most {MAX_LENGTH} characters. A field name, an element, and a term ID have at most " in api_md
        assert f"a term ID have at most {NAME_MAX_LENGTH} characters. An accession has at most " in api_md
        assert f"An accession has at most {ACCESSION_MAX_LENGTH} characters" in api_md

    def test_the_keyword_limits_of_the_docs_are_the_constants_of_the_code(self, api_md: str) -> None:
        assert f"at most {MAX_KEYWORDS} keywords and at most {MAX_KEYWORD_WORDS} words" in api_md

    def test_the_element_limit_of_the_docs_is_the_constant_of_the_code(self, api_md: str) -> None:
        assert f"A request names at most {MAX_ELEMENTS} elements of a dimension" in api_md

    def test_the_slug_descriptions_use_the_constants_of_the_code(self) -> None:
        assert f"{MAX_LENGTH} characters" in SLUG_INFO["unexpected-token"].cause
        assert f"{MAX_DEPTH} levels" in SLUG_INFO["nest-depth-exceeded"].cause
        assert f"{MAX_NODES} nodes" in SLUG_INFO["nest-depth-exceeded"].cause
        assert f"limit of {MAX_ELEMENTS}" in SLUG_INFO["too-many-elements"].cause

    def test_api_md_names_the_slug_of_each_rule_that_it_states(self, api_md: str) -> None:
        stated = set(re.findall(r"slug `([^`]+)`", api_md))
        assert stated == set(SLUG_INFO) - {"invalid-ast"}


def _operation_path(path: str, document: dict[str, Any]) -> str | None:
    """The path of the OpenAPI document that a path of llms.txt names, where `{name}` matches one segment."""
    for candidate in document["paths"]:
        pattern = re.sub(r"\\\{[^}]+\\\}", "[^/]+", re.escape(candidate))
        if re.fullmatch(pattern, path):
            return str(candidate)
    return None


def _code_spans(text: str) -> list[str]:
    return re.findall(r"`([^`]+)`", text)


def _operation_parameters(document: dict[str, Any]) -> dict[str, set[str]]:
    return {
        path: {p["name"] for op in item.values() if isinstance(op, dict) for p in op.get("parameters", [])}
        for path, item in document["paths"].items()
    }


@needs_docs
class TestLlmsTxt:
    def test_every_api_path_in_llms_txt_is_an_operation_of_the_openapi_document(
        self, llms: str, document: dict[str, Any]
    ) -> None:
        mentioned = {m.rstrip(".,:;)") for m in re.findall(r"(/api[A-Za-z0-9/{}._-]*)", llms)}
        assert len(mentioned) >= 5
        unknown = {path for path in mentioned if _operation_path(path, document) is None and path not in UNLISTED_PATHS}
        assert not unknown, unknown

    def test_every_query_parameter_in_llms_txt_is_a_parameter_of_its_operation(
        self, llms: str, document: dict[str, Any]
    ) -> None:
        by_path = _operation_parameters(document)
        every_parameter = set().union(*by_path.values())
        checked = 0
        for span in _code_spans(llms):
            path_match = re.search(r"(/api[A-Za-z0-9/{}._-]*)\?", span)
            for name in re.findall(r"[?&]([A-Za-z]+)=", span) if path_match else re.findall(r"^([A-Za-z]+)=", span):
                if path_match is not None:
                    operation_path = _operation_path(path_match.group(1), document)
                    assert operation_path is not None, path_match.group(1)
                    assert name in by_path[operation_path], f"{operation_path} has no parameter {name}"
                else:
                    assert name in every_parameter, f"no operation has a parameter {name}"
                checked += 1
        assert checked >= 6

    def test_every_heading_that_llms_txt_cites_exists_in_the_docs(self, llms: str) -> None:
        headings = _headings(API_MD, DATA_MODEL_MD)
        cited = set(re.findall(r'See "([^"]+)"', llms))
        assert len(cited) >= 5
        assert cited <= headings, cited - headings

    def test_llms_txt_does_not_offer_a_status_dimension_or_a_single_status(self, llms: str) -> None:
        assert "_status` distribution" not in llms
        assert not re.search(r"field=\w+_status", llms)
        assert "mapped_exact" not in llms
