"""An export reads the store page by page, and it names the dataset version.

The size of a page does not change the lines of an export. Each page starts after the last key of the previous page.
A query with many parameters does not search for modules, so that a page with many keys reads fast.
"""

from __future__ import annotations

import importlib.abc
import json
import sys
from collections.abc import Iterator, Sequence
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.api.app import create_app
from bsllmner_viewer.api.deps import parse_condition
from bsllmner_viewer.api.limits import Limits
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.queries.entries import keys_after, page_keys
from bsllmner_viewer.api.store import Store, record_missing_pandas
from bsllmner_viewer.build.ingest import build_full
from bsllmner_viewer.build.manifest import load_manifest
from tests.synthetic import generate

CONDITIONS = [None, "organism_id:9606", "NOT library_strategy:RNA-Seq", "hypoxia OR liver"]


def _export(store_path: Path, batch: int, path: str, q: str | None) -> str:
    with TestClient(create_app(store_path, Limits(export_batch=batch))) as client:
        response = client.get(path, params={"q": q} if q else {})
        assert response.status_code == 200, response.text
        text: str = response.text
        return text


@pytest.mark.parametrize("q", CONDITIONS)
@pytest.mark.parametrize("path", ["/api/export/entries/biosample", "/api/export/accessions/biosample"])
def test_an_export_has_the_same_lines_whatever_the_size_of_a_page(store_path: Path, path: str, q: str | None) -> None:
    whole = _export(store_path, 100_000, path, q)
    for batch in (1, 2, 7):
        assert _export(store_path, batch, path, q) == whole, batch


@pytest.mark.parametrize("q", CONDITIONS)
def test_the_keys_after_a_key_are_the_keys_of_the_population_that_follow_it_in_the_order_of_the_entry_list(
    store_path: Path, q: str | None
) -> None:
    store = Store(store_path)
    try:
        pop = population(parse_condition(store, q), store.field_set)
        with store.cursor(heavy=True) as cur:
            every = keys_after(cur, pop, None, 1_000_000)
            assert every == page_keys(cur, pop, 1, 1_000_000)
            assert every == sorted(set(every))
            for after in [None, "", "~", *every[:: max(1, len(every) // 7)], *every[-1:]]:
                for limit in (1, 3, 1000):
                    expected = [key for key in every if after is None or key > after][:limit]
                    assert keys_after(cur, pop, after, limit) == expected, (after, limit)
    finally:
        store.close()


class _Probe(importlib.abc.MetaPathFinder):
    def __init__(self) -> None:
        self.names: list[str] = []

    def find_spec(self, fullname: str, path: Sequence[str] | None, target: ModuleType | None = None) -> None:
        self.names.append(fullname)


def test_a_query_with_many_parameters_does_not_search_for_a_module(
    store_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    probe = _Probe()
    store = Store(store_path)
    try:
        keys = [f"SAMD{i:08d}" for i in range(500)]
        marks = ", ".join("?" for _ in keys)
        monkeypatch.setattr(sys, "meta_path", [probe, *sys.meta_path])
        with store.cursor() as cur:
            cur.execute(f"SELECT count(*) FROM biosample WHERE accession IN ({marks})", keys).fetchone()
    finally:
        store.close()
    assert probe.names == []


def test_pandas_is_recorded_as_missing_when_it_is_not_installed() -> None:
    modules: dict[str, Any] = {}
    record_missing_pandas(modules, lambda name: None)
    assert modules == {"pandas": None}


def test_an_installed_pandas_is_not_recorded_as_missing() -> None:
    modules: dict[str, Any] = {}
    record_missing_pandas(modules, lambda name: object())
    assert modules == {}


def test_an_imported_pandas_is_left_alone() -> None:
    pandas = ModuleType("pandas")
    modules: dict[str, Any] = {"pandas": pandas}
    record_missing_pandas(modules, lambda name: None)
    assert modules["pandas"] is pandas


EXPORTS = [
    "/api/export/entries/biosample",
    "/api/export/entries/biosample?format=ndjson",
    "/api/export/accessions/biosample",
    "/api/export/accessions/sra-experiment",
    "/api/export/accessions/sra-run",
    "/api/export/accessions/bioproject",
]


@pytest.mark.parametrize("path", EXPORTS)
def test_an_export_names_the_dataset_version_in_a_header(client: TestClient, path: str) -> None:
    version = client.get("/api/dataset").json()["datasetVersion"]
    response = client.get(path, params={"q": "organism_id:9606"})
    assert response.status_code == 200
    expected = f"{json.dumps(version['name'])} {version['createdAt']} {version['digest']}"
    assert response.headers["x-dataset-version"] == expected


@pytest.mark.parametrize("type_", ["biosample", "sra-experiment", "sra-run", "bioproject"])
def test_the_header_line_of_an_accession_list_names_the_same_dataset_version(client: TestClient, type_: str) -> None:
    response = client.get(f"/api/export/accessions/{type_}")
    header_line = response.text.splitlines()[0]
    assert header_line.endswith(f"; dataset={response.headers['x-dataset-version']}")


@pytest.mark.parametrize("path", EXPORTS)
def test_a_browser_of_another_origin_can_read_the_dataset_version_of_an_export(client: TestClient, path: str) -> None:
    response = client.get(path, headers={"Origin": "https://example.org"})
    exposed = {name.strip().lower() for name in response.headers["access-control-expose-headers"].split(",")}
    assert "x-dataset-version" in exposed


def test_a_refused_export_has_no_dataset_version(client: TestClient) -> None:
    response = client.get("/api/export/entries/biosample", params={"q": "nope:x"})
    assert response.status_code == 400
    assert "x-dataset-version" not in response.headers


def test_an_export_of_no_entries_has_only_the_header_in_tsv_and_no_line_in_ndjson(client: TestClient) -> None:
    full = client.get("/api/export/entries/biosample", params={"q": "organism_id:9606"})
    empty = client.get("/api/export/entries/biosample", params={"q": "SAMN99999999"})
    assert full.status_code == 200
    assert empty.status_code == 200
    assert len(full.text.splitlines()) > 1
    assert empty.text.splitlines() == [full.text.splitlines()[0]]
    ndjson = client.get("/api/export/entries/biosample", params={"q": "SAMN99999999", "format": "ndjson"})
    assert ndjson.status_code == 200
    assert ndjson.text == ""


TITLES = ["a\tb", "line1\r\nline2", "=SUM(A1)"]


@pytest.fixture(scope="module")
def titled_client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    syn = generate(tmp_path_factory.mktemp("titled"), seed=5, n_biosamples=30, n_runs=1)
    path = syn.root / "inputs" / "run1.jsonl"
    lines = path.read_text().splitlines()
    for index, line in enumerate(lines):
        doc = json.loads(line)
        doc.get("BioSample", doc)["Description"]["Title"] = TITLES[index % len(TITLES)]
        lines[index] = json.dumps(doc)
    path.write_text("\n".join(lines) + "\n")
    store = syn.root / "store" / "full.duckdb"
    assert build_full(load_manifest(syn.manifest), store, workers=1).ok
    with TestClient(create_app(store)) as client:
        yield client


def test_tsv_row_with_a_tab_a_line_break_or_a_formula_character_in_a_title_keeps_the_cell_count_and_the_value(
    titled_client: TestClient,
) -> None:
    response = titled_client.get("/api/export/entries/biosample")
    assert response.status_code == 200
    # splitlines would also split at other separators, so the TSV is split at "\n" only.
    rows = [line.split("\t") for line in response.text.split("\n") if line]
    header = rows[0]
    ndjson = titled_client.get("/api/export/entries/biosample", params={"format": "ndjson"})
    items = [json.loads(line) for line in ndjson.text.splitlines()]
    assert {item["title"] for item in items} == set(TITLES)
    assert len(rows) == len(items) + 1
    assert all(len(row) == len(header) for row in rows)
    titles = {row[header.index("title")] for row in rows[1:]}
    assert titles == {"a b", "line1  line2", "=SUM(A1)"}
