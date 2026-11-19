"""The api on a store whose manifest excludes a field: the api has the field nowhere."""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.api.app import create_app
from bsllmner_viewer.build.ingest import build_full
from bsllmner_viewer.build.manifest import load_manifest
from tests.api_helpers import entry_items
from tests.synthetic import FIELDS, LABELS, generate

PROBLEM_PREFIX = "https://ddbj.nig.ac.jp/problems/"
EXCLUDED = "chip_antigen"
KEPT = [name for name in FIELDS if name != EXCLUDED]
# A term that only the excluded field annotates with.
TERM = "NCBIGene:10664"


@pytest.fixture(scope="module")
def excluding(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    root = tmp_path_factory.mktemp("excluding")
    syn = generate(root / "syn", seed=5, n_biosamples=60, n_runs=2)
    head, _, tail = syn.manifest.read_text().partition("runs:\n")
    manifest = syn.root / "excluding.yaml"
    manifest.write_text(f"{head}excluded_fields: {json.dumps([EXCLUDED])}\nruns:\n{tail}")
    store = root / "excluding.duckdb"
    result = build_full(load_manifest(manifest), store, workers=1)
    assert result.ok, result.problems
    with TestClient(create_app(store)) as client:
        yield client


def test_dataset_reports_the_excluded_fields_and_lists_only_the_other_fields(excluding: TestClient) -> None:
    body = excluding.get("/api/dataset").json()
    assert body["version"]["excludedFields"] == [EXCLUDED]
    assert [f["name"] for f in body["fields"]] == KEPT
    assert not [f["name"] for f in body["dslFields"] if f["name"].startswith(EXCLUDED)]
    assert {f"{name}_status" for name in KEPT} <= {f["name"] for f in body["dslFields"]}


@pytest.mark.parametrize("q", [f'{EXCLUDED}:"{TERM}"', f"{EXCLUDED}_status:mapped", f'NOT {EXCLUDED}:"{TERM}"'])
def test_condition_on_an_excluded_field_is_an_unknown_field(excluding: TestClient, q: str) -> None:
    requests: list[tuple[str, dict[str, str]]] = [
        ("/api/entries/biosample", {}),
        ("/api/export/accessions/biosample", {}),
        ("/api/distribution", {"field": "disease"}),
    ]
    for path, params in requests:
        response = excluding.get(path, params={**params, "q": q})
        assert response.status_code == 400, path
        body = response.json()
        assert body["type"] == PROBLEM_PREFIX + "unknown-field"
        assert EXCLUDED in body["detail"]


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/api/distribution", {"field": EXCLUDED}),
        ("/api/crosstab", {"row": EXCLUDED, "col": "disease"}),
        ("/api/crosstab", {"row": "disease", "col": EXCLUDED}),
        ("/api/trend", {"field": EXCLUDED}),
        ("/api/terms", {"field": EXCLUDED}),
        ("/api/terms/children", {"field": EXCLUDED, "termId": TERM}),
    ],
)
def test_aggregation_and_term_search_on_an_excluded_field_are_an_unknown_field(
    excluding: TestClient, path: str, params: dict[str, str]
) -> None:
    response = excluding.get(path, params=params)
    assert response.status_code == 400
    assert response.json()["type"] == PROBLEM_PREFIX + "unknown-field"


def test_entries_and_a_biosample_have_no_annotations_of_an_excluded_field(excluding: TestClient) -> None:
    items = entry_items(excluding)
    assert items
    assert all(list(item["annotations"]) == KEPT for item in items)
    for item in items:
        detail = excluding.get(f"/api/entries/biosample/{item['identifier']}").json()
        assert {a["field"] for a in detail["annotations"]} == set(KEPT)


def test_export_of_entries_has_no_column_and_no_member_of_an_excluded_field(excluding: TestClient) -> None:
    tsv = excluding.get("/api/export/entries/biosample", params={"format": "tsv"})
    assert tsv.status_code == 200
    header = next(line for line in tsv.text.splitlines() if not line.startswith("#")).split("\t")
    assert header[-len(KEPT) :] == KEPT
    assert EXCLUDED not in header
    ndjson = excluding.get("/api/export/entries/biosample", params={"format": "ndjson"})
    assert ndjson.status_code == 200
    rows = [json.loads(line) for line in ndjson.text.splitlines() if line and not line.startswith("#")]
    assert rows
    assert all(list(row["annotations"]) == KEPT for row in rows)


def test_term_search_finds_no_term_through_an_excluded_field(excluding: TestClient, client: TestClient) -> None:
    for query in (TERM, LABELS[TERM]):
        assert [h["field"] for h in client.get("/api/terms", params={"query": query}).json()["terms"]] == [EXCLUDED]
        assert excluding.get("/api/terms", params={"query": query}).json()["terms"] == []
    fields = {h["field"] for h in excluding.get("/api/terms", params={"limit": 100}).json()["terms"]}
    assert fields
    assert fields <= set(KEPT)
