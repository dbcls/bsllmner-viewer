"""Every operation answers an unknown query parameter with 422, and answers only with the statuses that it declares."""

from __future__ import annotations

import re
import string
from typing import Any

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

SEGMENT = st.text(alphabet=string.ascii_letters + string.digits + ":-", min_size=1, max_size=20)


def _operations(client: TestClient) -> list[tuple[str, str, dict[str, Any]]]:
    spec = client.get("/api/openapi.json").json()
    return [
        (method.upper(), path, operation) for path, item in spec["paths"].items() for method, operation in item.items()
    ]


def _fill(path: str, values: dict[str, str]) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: values[m.group(1)], path)


@pytest.fixture(scope="module")
def get_operations(client: TestClient) -> list[tuple[str, dict[str, Any]]]:
    return [(path, op) for method, path, op in _operations(client) if method == "GET"]


@settings(max_examples=150)
@given(
    st.data(),
    st.text(alphabet=string.ascii_letters + string.digits + "_", min_size=1, max_size=12),
    SEGMENT,
)
def test_an_undeclared_query_parameter_is_unprocessable_and_named_in_the_detail(
    client: TestClient, get_operations: list[tuple[str, dict[str, Any]]], data: st.DataObject, name: str, segment: str
) -> None:
    path, operation = data.draw(st.sampled_from(get_operations))
    declared = {p["name"] for p in operation.get("parameters", []) if p["in"] == "query"}
    unknown = name if name not in declared else name + "_x"
    values = {"type": "biosample", "accession": segment, "termId": segment}
    response = client.get(_fill(path, values), params={unknown: "1"})
    assert response.status_code == 422, (path, unknown)
    assert response.json()["type"] == "about:blank"
    assert unknown in response.json()["detail"]


_VALUES = st.one_of(
    st.just(""),
    st.text(max_size=40),
    st.sampled_from(["disease", "tissue", "library_strategy", "organism_id", "date_published", "bioproject"]),
    st.sampled_from(["biosample", "sra-experiment", "bioproject", "tsv", "ndjson", "toggle", "narrow"]),
    st.integers(min_value=-5, max_value=2**40).map(str),
    st.sampled_from(["true", "false", "disease:A", "NOT x", "a OR", "date_published:[2020-01-01 TO 2010-01-01]"]),
)


@settings(max_examples=200)
@given(st.data(), SEGMENT)
def test_a_get_operation_answers_only_with_a_declared_status(
    client: TestClient, get_operations: list[tuple[str, dict[str, Any]]], data: st.DataObject, segment: str
) -> None:
    path, operation = data.draw(st.sampled_from(get_operations))
    names = [p["name"] for p in operation.get("parameters", []) if p["in"] == "query"]
    chosen = data.draw(st.lists(st.sampled_from(names), unique=True, max_size=len(names))) if names else []
    params = {name: data.draw(_VALUES) for name in chosen}
    path_values = {"type": data.draw(st.sampled_from(["biosample", "sra-run", "nope"])), "accession": segment}
    path_values["termId"] = segment
    response = client.get(_fill(path, path_values), params=params)
    declared = {int(code) for code in operation["responses"]}
    assert response.status_code in declared, (path, params, response.status_code, response.text)


_JSON = st.recursive(
    st.one_of(st.none(), st.booleans(), st.integers(), st.text(max_size=20)),
    lambda children: st.one_of(
        st.lists(children, max_size=3), st.dictionaries(st.text(max_size=10), children, max_size=4)
    ),
    max_leaves=8,
)
_OPTIONAL_Q = st.one_of(st.none(), st.text(max_size=20))
_CLAUSE = st.fixed_dictionaries(
    {"field": st.sampled_from(["disease", "nope", "organism_id", "date_published"])},
    optional={"value": st.text(max_size=10), "from": st.text(max_size=12), "to": st.text(max_size=12)},
)


@settings(max_examples=100)
@given(
    st.sampled_from(["/api/dsl/select", "/api/dsl/keyword"]),
    st.one_of(
        _JSON,
        st.fixed_dictionaries(
            {"clauses": st.lists(_CLAUSE, max_size=3)},
            optional={
                "q": st.one_of(st.none(), st.text(max_size=20)),
                "mode": st.sampled_from(["toggle", "narrow", "x"]),
            },
        ),
        st.fixed_dictionaries(
            {"keyword": st.text(max_size=30)}, optional={"q": st.one_of(st.none(), st.text(max_size=20))}
        ),
    ),
)
def test_a_post_operation_answers_only_with_a_declared_status(client: TestClient, path: str, body: Any) -> None:
    spec = client.get("/api/openapi.json").json()
    declared = {int(code) for code in spec["paths"][path]["post"]["responses"]}
    response = client.post(path, json=body)
    assert response.status_code in declared, (path, body, response.status_code, response.text)
    if response.status_code >= 400:
        assert response.headers["content-type"].startswith("application/problem+json")
