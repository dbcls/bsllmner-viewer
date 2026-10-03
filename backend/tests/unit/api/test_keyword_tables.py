"""A keyword selects its BioSamples once per cursor, and the counts do not depend on how it is evaluated."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import duckdb
import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings

from bsllmner_viewer.api.app import create_app
from bsllmner_viewer.api.queries import aggregate, core, dimensions, entries, projects, terms
from bsllmner_viewer.api.queries.core import Population, population
from bsllmner_viewer.api.schemas import Unit
from bsllmner_viewer.api.store import Store
from bsllmner_viewer.dsl.ast import Node
from bsllmner_viewer.dsl.compile import compile_condition
from bsllmner_viewer.dsl.parser import parse
from tests.api_helpers import condition_q
from tests.strategies import conditions
from tests.synthetic import ANNOTATED

UNITS: tuple[Unit, ...] = ("biosample", "sra-experiment", "bioproject")
MARK = "SAMN99999999"
Q = [
    "cancer",
    '"breast cancer"',
    "NOT cancer",
    "cancer OR liver",
    "cancer AND liver",
    "NOT (cancer OR liver)",
    '(cancer OR liver) AND NOT disease:"' + ANNOTATED["disease"][0][0] + '"',
    'cancer AND disease:"' + ANNOTATED["disease"][0][0] + '"',
    "NOT (liver OR cancer) AND library_strategy:RNA-Seq",
    "cancer AND SAMN00000001",
    "SAMN00000001",
]


@pytest.fixture(scope="module")
def store(store_path: Path) -> Iterator[Store]:
    s = Store(store_path)
    yield s
    s.close()


def _pop(store: Store, q: str | None, keyword_tables: bool = True) -> Population:
    return population(parse(q) if q else None, store.field_set, keyword_tables)


def _read_all(store: Store, cur: duckdb.DuckDBPyConnection, pop: Population, other: Population) -> dict[str, Any]:
    """The result of every query function of the requests, for the population `pop` and a second one `other`.

    `other` stands for the population of another field of a request with self-exclusion.
    """
    disease = dimensions.dimension(store.field_set, "disease")
    assay = dimensions.dimension(store.field_set, "library_strategy")
    out: dict[str, Any] = {
        "count_entries": entries.count_entries(cur, pop),
        "page_keys": entries.page_keys(cur, pop, 1, 5),
        "count_projects": projects.count_projects(cur, pop),
        "project_page": projects.project_page(cur, pop, "biosampleCount:desc", 1, 5),
        "years": core.population_years(cur, pop),
        "terms_listed": terms.search_terms(cur, {"disease": pop, "tissue": other}, "", 20),
        "terms_matched": terms.search_terms(cur, {"disease": pop, "tissue": other}, "a", 20),
    }
    keys = entries.keys_after(cur, pop, None, 5)
    out["entry_rows"] = entries.entry_rows(cur, pop, keys, ("disease",))
    for unit in UNITS:
        elements = dimensions.default_elements(cur, disease, pop, 5)
        assay_elements = dimensions.default_elements(cur, assay, other, 5)
        out[f"total_{unit}"] = aggregate.population_total(cur, pop, unit)
        out[f"counts_{unit}"] = aggregate.element_counts(cur, pop, disease, elements, unit)
        out[f"crosstab_{unit}"] = aggregate.crosstab(cur, pop, disease, elements, assay, assay_elements, unit)
        out[f"trend_{unit}"] = aggregate.trend(cur, pop, disease, elements, unit)
        out[f"trend_total_{unit}"] = aggregate.trend_total(cur, pop, unit)
    return out


def _same(store: Store, q: str | None) -> None:
    other = "liver"
    with store.cursor(heavy=True) as cur:
        expected = _read_all(store, cur, _pop(store, q, keyword_tables=False), _pop(store, other, keyword_tables=False))
    with store.cursor(heavy=True) as cur:
        assert _read_all(store, cur, _pop(store, q), _pop(store, other)) == expected, q


@pytest.mark.parametrize("q", Q)
def test_keyword_tables_queries_return_what_the_inline_keyword_returns(store: Store, q: str) -> None:
    _same(store, q)


@given(ast=conditions)
@settings(max_examples=40, deadline=None)
def test_keyword_tables_property_queries_return_what_the_inline_keyword_returns(store: Store, ast: Node | None) -> None:
    _same(store, condition_q(ast))


@pytest.mark.parametrize("q", Q)
def test_keyword_tables_entries_total_equals_the_count_of_the_inline_predicate(
    store_path: Path, store_con: duckdb.DuckDBPyConnection, store: Store, q: str
) -> None:
    pred = compile_condition(parse(q), store.field_set, keyword_tables=False)
    row = store_con.execute(
        f"SELECT count(DISTINCT pn.biosample) FROM population pn WHERE {pred.sql}", pred.params
    ).fetchone()
    assert row is not None
    with TestClient(create_app(store_path)) as client:
        response = client.get("/api/entries/biosample", params={"q": q})
    assert response.status_code == 200, response.text
    assert response.json()["pagination"]["total"] == row[0]


def _mark(cur: duckdb.DuckDBPyConnection, pop: Population) -> str:
    """Create the keyword table of `pop` and put a row in it that no scan of the searchable text produces."""
    assert len(pop.tables) == 1
    pop.cte(cur)
    name = pop.tables[0].name
    cur.execute(f"INSERT INTO {name} VALUES (?)", [MARK])
    return name


def _marked(cur: duckdb.DuckDBPyConnection, name: str) -> int:
    row = cur.execute(f"SELECT count(*) FROM {name} WHERE biosample = ?", [MARK]).fetchone()
    assert row is not None
    return int(row[0])


def test_keyword_tables_a_request_reads_the_table_that_the_first_use_created(store: Store) -> None:
    pop = _pop(store, "cancer")
    other = _pop(store, 'cancer AND disease:"' + ANNOTATED["disease"][0][0] + '"')
    with store.cursor(heavy=True) as cur:
        name = _mark(cur, pop)
        _read_all(store, cur, pop, other)
        _read_all(store, cur, other, pop)
        assert _marked(cur, name) == 1
        assert [t.name for t in other.tables] == [name]


def test_keyword_tables_the_population_of_self_exclusion_reads_the_same_table(store: Store) -> None:
    full = _pop(store, "cancer AND tissue:liver")
    without_clause = _pop(store, "cancer")
    assert [t.name for t in full.tables] == [t.name for t in without_clause.tables]
    assert full.sql != without_clause.sql


def test_keyword_tables_two_keywords_make_two_tables_that_each_scan_once(store: Store) -> None:
    pop = _pop(store, "cancer AND NOT liver")
    assert len(pop.tables) == 2
    with store.cursor(heavy=True) as cur:
        for table in pop.tables:
            cur.execute(f"CREATE TEMP TABLE IF NOT EXISTS {table.name} AS {table.sql}", list(table.params))
            cur.execute(f"INSERT INTO {table.name} VALUES (?)", [MARK])
        _read_all(store, cur, pop, pop)
        assert [_marked(cur, t.name) for t in pop.tables] == [1, 1]


def test_keyword_tables_an_export_that_reads_pages_scans_once(store: Store) -> None:
    pop = _pop(store, "cancer")
    session = store.open_export()
    try:
        name = _mark(session.cursor, pop)
        after: str | None = None
        seen: list[str] = []
        while keys := entries.keys_after(session.cursor, pop, after, 2):
            entries.entry_rows(session.cursor, pop, keys, ("disease",))
            seen += keys
            after = keys[-1]
        assert len(seen) > 2
        assert _marked(session.cursor, name) == 1
    finally:
        session.close()


@pytest.mark.parametrize("heavy", [True, False])
def test_keyword_tables_a_cursor_is_closed_after_its_request_and_its_temp_table_goes_with_it(
    store: Store, heavy: bool
) -> None:
    pop = _pop(store, "cancer")
    with store.cursor(heavy=heavy) as cur:
        name = _mark(cur, pop)
        assert _marked(cur, name) == 1
    with pytest.raises(duckdb.ConnectionException):
        cur.execute("SELECT 1")


def test_keyword_tables_an_export_session_closes_its_cursor(store: Store) -> None:
    pop = _pop(store, "cancer")
    session = store.open_export()
    _mark(session.cursor, pop)
    session.close()
    with pytest.raises(duckdb.ConnectionException):
        session.cursor.execute("SELECT 1")
