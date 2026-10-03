"""Where a term element sits in the ontology: its parents in the list and its child terms, as in docs/api.md."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import Node
from tests.pbt.api.test_invariants import UNITS, _and, _count, _q, conditions
from tests.synthetic import ONTOLOGIES

ONTOLOGY_OF = {
    "cell_line": "cellosaurus",
    "disease": "mondo",
    "tissue": "uberon",
    "drug": "chebi",
    "chip_antigen": "gene",
}
PARENTS = {term_id: set(parents) for terms in ONTOLOGIES.values() for term_id, _, _, parents in terms}


def _children(field: str, term_id: str) -> list[str]:
    return [t for t, _, _, parents in ONTOLOGIES[ONTOLOGY_OF[field]] if term_id in parents]


def _terms_of(field: str) -> list[str]:
    return [t for t, _, _, _ in ONTOLOGIES[ONTOLOGY_OF[field]]]


@st.composite
def axes(draw: st.DrawFn) -> tuple[str, list[str]]:
    """A term field and some of its terms, as the elements that a request names."""
    field = draw(st.sampled_from(sorted(ONTOLOGY_OF)))
    terms = draw(st.lists(st.sampled_from(_terms_of(field)), min_size=1, max_size=6, unique=True))
    return field, terms


def _crosstab(client: TestClient, ast: Node | None, row: tuple[str, list[str]], unit: str) -> dict[str, Any]:
    field, terms = row
    col = "library_strategy"
    params = {"row": field, "col": col, "rowElements": ",".join(terms), "q": _q(ast) or "", "unit": unit}
    body: dict[str, Any] = client.get("/api/crosstab", params={**params, "facetSelfExclude": "true"}).json()
    return body


@settings(max_examples=30)
@given(conditions, axes(), st.sampled_from(UNITS))
def test_term_element_parents_are_the_elements_of_its_list_that_are_its_direct_parents(
    client: TestClient, ast: Node | None, row: tuple[str, list[str]], unit: str
) -> None:
    body = _crosstab(client, ast, row, unit)
    values = [e["value"] for e in body["rows"]]
    for element in body["rows"]:
        expected = [v for v in values if v in PARENTS[element["value"]]]
        assert element["parents"] == expected, element["value"]


@settings(max_examples=30)
@given(conditions, axes(), st.sampled_from(UNITS))
def test_term_element_has_children_when_a_direct_child_has_a_count_in_the_population_of_its_list(
    client: TestClient, ast: Node | None, row: tuple[str, list[str]], unit: str
) -> None:
    field, _ = row
    body = _crosstab(client, ast, row, unit)
    pop = body["populationQ"]
    for element in body["rows"]:
        counted = {
            child
            for child in _children(field, element["value"])
            if _count(client, _and(pop, [{"field": field, "value": child}]), unit) > 0
        }
        assert element["hasChildren"] == bool(counted), element["value"]
        params = {"field": field, "termId": element["value"], "q": pop or "", "unit": unit, "facetSelfExclude": "true"}
        children = client.get("/api/terms/children", params=params).json()["children"]
        assert {c["value"] for c in children} == counted
        assert all(c["count"] >= 1 for c in children)


@settings(max_examples=20)
@given(conditions, st.sampled_from(sorted(ONTOLOGY_OF)), st.sampled_from(UNITS), st.booleans())
def test_distribution_term_elements_have_children_exactly_when_the_children_endpoint_lists_some(
    client: TestClient, ast: Node | None, field: str, unit: str, excl: bool
) -> None:
    flag = str(excl).lower()
    q = _q(ast) or ""
    params = {"field": field, "q": q, "unit": unit, "facetSelfExclude": flag}
    body = client.get("/api/distribution", params=params).json()
    for element in body["elements"]:
        params = {"field": field, "termId": element["value"], "q": q, "unit": unit, "facetSelfExclude": flag}
        children = client.get("/api/terms/children", params=params).json()["children"]
        assert element["hasChildren"] == bool(children), element["value"]
