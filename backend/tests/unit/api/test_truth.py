"""Entries, counts, and omitted conditions against the answer that the generator decided."""

from __future__ import annotations

import shutil
from itertools import combinations
from pathlib import Path
from typing import Any

import duckdb
import pytest
from fastapi.testclient import TestClient

from bsllmner_viewer.api.app import create_app
from bsllmner_viewer.store.version import read_version
from tests.api_helpers import accessions, count, entry_items
from tests.pbt.api.test_condition_truth import (
    UNITS,
    mapped_terms,
    population_pairs,
    selected_run,
    with_descendants,
)
from tests.synthetic import TARGET_ASSAYS, Synthetic


def test_a_condition_with_two_different_assays_matches_nothing_even_for_a_biosample_with_both(
    client: TestClient, synthetic: Synthetic
) -> None:
    assays: dict[str, set[str]] = {}
    for accession, experiment in population_pairs(synthetic):
        assay = dict(synthetic.truth.experiments[accession])[experiment]
        assays.setdefault(accession, set()).add(assay)
    assert any({"RNA-Seq", "ChIP-Seq"} <= found for found in assays.values())
    both = "library_strategy:RNA-Seq AND library_strategy:ChIP-Seq"
    for unit in UNITS:
        assert accessions(client, unit, both) == [], unit
    assert count(client, "library_strategy:RNA-Seq") >= 1
    assert count(client, "library_strategy:ChIP-Seq") >= 1


def _cooccurring(groups: list[set[str]]) -> tuple[str, str]:
    """The pair of values that occur together in the most groups."""
    values = sorted(set().union(*groups))
    best = max(combinations(values, 2), key=lambda pair: sum(set(pair) <= g for g in groups))
    assert any(set(best) <= g for g in groups)
    return best


def _truth_groups(synthetic: Synthetic, kind: str) -> list[set[str]]:
    truth = synthetic.truth
    population = sorted({b for b, _ in population_pairs(synthetic)})
    if kind == "drug":
        return [mapped_terms(synthetic, b, "drug") for b in population]
    if kind == "assay":
        pairs = population_pairs(synthetic)
        return [{dict(truth.experiments[b])[e] for bb, e in pairs if bb == b} for b in population]
    return [set(truth.bioprojects[b]) for b in population]


@pytest.mark.parametrize("kind", ["hierarchy", "drug", "assay", "project"])
def test_sum_of_element_counts_exceeds_the_count_of_their_union_when_a_unit_is_in_several_elements(
    client: TestClient, synthetic: Synthetic, kind: str
) -> None:
    if kind == "hierarchy":
        first, second = "MONDO:0004992", "MONDO:0007254"
        below = with_descendants(first), with_descendants(second)
        both = [
            b
            for b in {b for b, _ in population_pairs(synthetic)}
            if mapped_terms(synthetic, b, "disease") & below[0] and mapped_terms(synthetic, b, "disease") & below[1]
        ]
        assert both
        elements = {e["value"]: e["count"] for e in _distribution(client, "disease", [first, second])}
        union = f'disease:"{first}" OR disease:"{second}"'
        assert sum(elements.values()) > count(client, union)
        return
    if kind == "project":
        first, second = _cooccurring(_truth_groups(synthetic, "project"))
        body = client.get("/api/projects", params={"perPage": 100}).json()
        counts = {p["identifier"]: p["biosampleCount"] for p in body["items"]}
        total = counts[first] + counts[second]
        union = f"bioproject:{first} OR bioproject:{second}"
    elif kind == "drug":
        first, second = _cooccurring(_truth_groups(synthetic, "drug"))
        total = sum(e["count"] for e in _distribution(client, "drug", [first, second]))
        union = f'drug:"{first}" OR drug:"{second}"'
    else:
        first, second = _cooccurring(_truth_groups(synthetic, "assay"))
        assert {first, second} <= set(TARGET_ASSAYS)
        total = sum(e["count"] for e in _distribution(client, "library_strategy", [first, second]))
        union = f"library_strategy:{first} OR library_strategy:{second}"
    assert total > count(client, union)


def _distribution(client: TestClient, field: str, elements: list[str]) -> list[dict[str, Any]]:
    body = client.get("/api/distribution", params={"field": field, "elements": ",".join(elements)}).json()
    return list(body["elements"])


def _empty_and_omitted(client: TestClient, path: str, params: dict[str, str]) -> tuple[Any, Any]:
    empty = client.get(path, params={**params, "q": ""})
    omitted = client.get(path, params=params)
    assert empty.status_code == omitted.status_code == 200, (path, empty.text)
    return empty.text, omitted.text


READS = [
    ("/api/entries/biosample", {}),
    ("/api/distribution", {"field": "disease"}),
    ("/api/distribution", {"field": "library_strategy"}),
    ("/api/crosstab", {"row": "disease", "col": "library_strategy"}),
    ("/api/trend", {"field": "organism_id"}),
    ("/api/projects", {}),
    ("/api/terms", {"field": "disease", "query": "cancer"}),
    ("/api/terms/children", {"field": "disease", "termId": "MONDO:0000001"}),
    ("/api/export/accessions/biosample", {}),
    ("/api/export/entries/biosample", {"format": "ndjson"}),
]


@pytest.mark.parametrize(("path", "params"), READS, ids=[p for p, _ in READS])
def test_an_empty_q_equals_an_omitted_q_for_every_operation_that_takes_q(
    client: TestClient, path: str, params: dict[str, str]
) -> None:
    empty, omitted = _empty_and_omitted(client, path, params)
    assert empty == omitted
    assert len(omitted) > 100


def test_the_population_of_an_omitted_q_is_the_biosamples_with_an_experiment_of_a_target_assay(
    client: TestClient, synthetic: Synthetic
) -> None:
    population = {b for b, _ in population_pairs(synthetic)}
    assert population < set(synthetic.accessions)
    total = client.get("/api/entries/biosample").json()["pagination"]["total"]
    assert total == len(population)


def test_entry_bioprojects_are_the_bioprojects_of_the_biosample(client: TestClient, synthetic: Synthetic) -> None:
    for accession in synthetic.accessions:
        body = client.get(f"/api/entries/biosample/{accession}").json()
        assert {p["accession"] for p in body["bioprojects"]} == set(synthetic.truth.bioprojects[accession]), accession


def test_entry_of_every_biosample_is_found_and_its_experiments_are_in_the_population_exactly_for_a_target_assay(
    client: TestClient, synthetic: Synthetic
) -> None:
    outside = 0
    for accession in synthetic.accessions:
        response = client.get(f"/api/entries/biosample/{accession}")
        assert response.status_code == 200, accession
        rows = synthetic.truth.experiments[accession]
        experiments = response.json()["experiments"]
        assert [(e["accession"], e["libraryStrategy"]) for e in experiments] == sorted(rows)
        assert [e["inPopulation"] for e in experiments] == [a in TARGET_ASSAYS for _, a in sorted(rows)]
        outside += not any(a in TARGET_ASSAYS for _, a in rows)
    assert outside > 0, "the generator makes BioSamples outside the population"


def test_entry_and_row_keep_the_organism_name_of_their_input_entry(client: TestClient, synthetic: Synthetic) -> None:
    dataset = {o["identifier"]: o["name"] for o in client.get("/api/dataset").json()["organisms"]}
    rows = {item["identifier"]: item for item in entry_items(client)}
    checked = 0
    for accession in synthetic.accessions:
        if int(accession[4:]) % 7 != 0:
            continue
        taxonomy_id, name = synthetic.truth.organisms[(selected_run(synthetic, accession), accession)]
        assert name != dataset[str(taxonomy_id)]
        detail = client.get(f"/api/entries/biosample/{accession}").json()
        assert detail["organism"] == {"identifier": str(taxonomy_id), "name": name}, accession
        if accession in rows:
            assert rows[accession]["organism"] == {"identifier": str(taxonomy_id), "name": name}, accession
            checked += 1
    assert checked > 0


def test_keyword_matches_a_kept_attribute_that_the_entry_page_leaves_out(
    client: TestClient, synthetic: Synthetic, store_con: duckdb.DuckDBPyConnection
) -> None:
    population = {b for b, _ in population_pairs(synthetic)}
    chosen = [
        accession
        for (accession,) in store_con.execute(
            "SELECT b.accession FROM biosample b JOIN population p ON p.biosample = b.accession "
            "WHERE contains(b.attributes, 'Submitter Id') AND contains(b.attributes, 'submitter ' || b.accession) "
            "ORDER BY b.accession"
        ).fetchall()
    ]
    assert chosen
    for accession in chosen:
        assert accession in population
        detail = client.get(f"/api/entries/biosample/{accession}").json()
        assert all(item["name"] != "Submitter Id" for item in detail["metadata"]), accession
        assert all(f"submitter {accession}" not in item["value"] for item in detail["metadata"]), accession
        assert accession in accessions(client, "biosample", f'"submitter {accession}"'), accession


def _first_biosample_with_evidence_in_two_fields(client: TestClient, synthetic: Synthetic) -> tuple[str, str, str]:
    for accession in synthetic.accessions:
        body = client.get(f"/api/entries/biosample/{accession}").json()
        fields = [a["field"] for a in body["annotations"] if a["evidence"]]
        if len(set(fields)) >= 2:
            return accession, fields[0], fields[-1]
    raise AssertionError("no BioSample has evidence in two fields")


def test_entry_evidence_is_the_stored_evidence_and_not_a_new_trace(
    client: TestClient, synthetic: Synthetic, store_path: Path, tmp_path: Path
) -> None:
    accession, removed, kept = _first_biosample_with_evidence_in_two_fields(client, synthetic)
    before = client.get(f"/api/entries/biosample/{accession}").json()
    copy = tmp_path / "copy.duckdb"
    shutil.copyfile(store_path, copy)
    con = duckdb.connect(str(copy))
    con.execute("DELETE FROM evidence WHERE biosample = ? AND field = ?", [accession, removed])
    con.close()
    with TestClient(create_app(copy)) as other:
        after = other.get(f"/api/entries/biosample/{accession}").json()

    def evidence(body: dict[str, Any], field: str) -> list[Any]:
        return [a["evidence"] for a in body["annotations"] if a["field"] == field]

    assert any(evidence(before, removed))
    assert not any(evidence(after, removed))
    assert evidence(after, kept) == evidence(before, kept)


def _camel(value: Any) -> Any:
    if isinstance(value, dict):
        return {_camel_key(k): _camel(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_camel(v) for v in value]
    return value


def _camel_key(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(part.capitalize() for part in rest)


def test_dataset_version_equals_the_version_of_the_store_with_camel_case_keys(
    client: TestClient, store_con: duckdb.DuckDBPyConnection
) -> None:
    stored = read_version(store_con).model_dump(mode="json")
    assert client.get("/api/dataset").json()["version"] == _camel(stored)
