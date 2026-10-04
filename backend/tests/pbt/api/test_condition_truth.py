"""Conditions against the answer that the generator decided, not against the store or the api.

Each expected set is computed from `Synthetic.truth` and the generator's ontologies, so a bug in the build or the api
that the store and the api share cannot hide.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import cache
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.api_helpers import accessions
from tests.synthetic import FIELDS, ONTOLOGIES, TARGET_ASSAYS, Synthetic

Pair = tuple[str, str]

# docs/data-model.md, "Annotation status".
GROUP_STATUSES = {
    "no_value": {"not_stated", "extraction_failed"},
    "unmapped": {"unmapped_no_candidate", "unmapped_rejected"},
    "mapped": {"mapped_exact", "mapped_selected"},
}
UNITS = ("biosample", "sra-experiment", "bioproject")


def field_ontology(field: str) -> str:
    return Path(str(FIELDS[field]["ontology_file"])).stem


@cache
def _children() -> dict[str, set[str]]:
    children: dict[str, set[str]] = {}
    for terms in ONTOLOGIES.values():
        for term_id, _, _, parents in terms:
            for parent in parents:
                children.setdefault(parent, set()).add(term_id)
    return children


def with_descendants(term_id: str) -> set[str]:
    """The term and every term below it over the parent relations of the generator's ontologies."""
    found = {term_id}
    stack = [term_id]
    while stack:
        for child in _children().get(stack.pop(), ()):
            if child not in found:
                found.add(child)
                stack.append(child)
    return found


def selected_run(synthetic: Synthetic, accession: str) -> str:
    """The first run of the manifest that holds the BioSample."""
    for run in synthetic.run_names:
        if (run, accession) in synthetic.truth.organisms:
            return run
    raise AssertionError(accession)


def population_pairs(synthetic: Synthetic) -> list[Pair]:
    """The (BioSample, experiment) pairs whose assay is a target assay."""
    return [
        (accession, experiment)
        for accession, rows in synthetic.truth.experiments.items()
        for experiment, assay in rows
        if assay in TARGET_ASSAYS
    ]


def mapped_terms(synthetic: Synthetic, accession: str, field: str) -> set[str]:
    run = selected_run(synthetic, accession)
    rows = synthetic.truth.annotations[(run, accession, field)]
    return {term for _, status, term in rows if status.startswith("mapped") and term is not None}


def statuses(synthetic: Synthetic, accession: str, field: str) -> set[str]:
    run = selected_run(synthetic, accession)
    return {status for _, status, _ in synthetic.truth.annotations[(run, accession, field)]}


def organism_id(synthetic: Synthetic, accession: str) -> int:
    return synthetic.truth.organisms[(selected_run(synthetic, accession), accession)][0]


TERM_CASES = [(field, term_id) for field in FIELDS for term_id, _, _, _ in ONTOLOGIES[field_ontology(field)]]


@pytest.mark.parametrize("negate", [False, True], ids=["plain", "not"])
@pytest.mark.parametrize(("field", "term_id"), TERM_CASES)
def test_a_term_condition_selects_exactly_the_biosamples_with_the_term_or_a_descendant(
    client: TestClient, synthetic: Synthetic, field: str, term_id: str, negate: bool
) -> None:
    pairs = population_pairs(synthetic)
    population = {b for b, _ in pairs}
    below = with_descendants(term_id)
    having = {b for b in population if mapped_terms(synthetic, b, field) & below}
    q = f'{field}:"{term_id}"'
    if negate:
        assert accessions(client, "biosample", f"NOT {q}") == sorted(population - having)
    else:
        assert accessions(client, "biosample", q) == sorted(having)


# Every field with the groups. The selected run decides the statuses of a BioSample.
@pytest.mark.parametrize("negate", [False, True], ids=["plain", "not"])
@pytest.mark.parametrize("group", sorted(GROUP_STATUSES))
@pytest.mark.parametrize("field", list(FIELDS))
def test_a_status_group_condition_selects_the_biosamples_with_a_status_of_the_group(
    client: TestClient, synthetic: Synthetic, field: str, group: str, negate: bool
) -> None:
    population = {b for b, _ in population_pairs(synthetic)}
    having = {b for b in population if statuses(synthetic, b, field) & GROUP_STATUSES[group]}
    assert having, "the generator makes every group in every field"
    q = f"{field}_status:{group}"
    if negate:
        assert accessions(client, "biosample", f"NOT {q}") == sorted(population - having)
    else:
        assert accessions(client, "biosample", q) == sorted(having)


Tree = tuple[Any, ...]  # ("leaf", clause) | ("NOT", tree) | ("AND" | "OR", [tree, ...])


def _leaves(synthetic: Synthetic) -> st.SearchStrategy[Tree]:
    projects = sorted({p for ps in synthetic.truth.bioprojects.values() for p in ps})
    by_size = sorted(projects, key=lambda p: sum(p in ps for ps in synthetic.truth.bioprojects.values()))
    chosen_projects = [by_size[0], by_size[len(by_size) // 2], by_size[-1]]
    terms = [(f, t) for f, t in TERM_CASES]
    clauses = [
        *(("organism_id", str(n)) for n in (9606, 10090)),
        *(("bioproject", p) for p in chosen_projects),
        *(("library_strategy", a) for a in TARGET_ASSAYS),
        *terms,
    ]
    return st.sampled_from(clauses).map(lambda c: ("leaf", c))


def _trees(synthetic: Synthetic) -> st.SearchStrategy[Tree]:
    return st.recursive(
        _leaves(synthetic),
        lambda children: st.one_of(
            st.tuples(st.just("NOT"), children),
            st.tuples(st.sampled_from(["AND", "OR"]), st.lists(children, min_size=2, max_size=3)),
        ),
        max_leaves=3,
    )


def _text(tree: Tree) -> str:
    kind = tree[0]
    if kind == "leaf":
        field, value = tree[1]
        return f'{field}:"{value}"'
    if kind == "NOT":
        return f"NOT ({_text(tree[1])})"
    return "(" + f" {kind} ".join(f"({_text(t)})" for t in tree[1]) + ")"


def _truth_of_leaf(synthetic: Synthetic, field: str, value: str) -> Callable[[Pair], bool]:
    truth = synthetic.truth
    if field == "organism_id":
        return lambda pair: organism_id(synthetic, pair[0]) == int(value)
    if field == "bioproject":
        return lambda pair: value in truth.bioprojects[pair[0]]
    if field == "library_strategy":
        assays = {e: a for rows in truth.experiments.values() for e, a in rows}
        return lambda pair: assays[pair[1]] == value
    below = with_descendants(value)
    return lambda pair: bool(mapped_terms(synthetic, pair[0], field) & below)


def _holds(synthetic: Synthetic, tree: Tree, pair: Pair) -> bool:
    kind = tree[0]
    if kind == "leaf":
        return _truth_of_leaf(synthetic, *tree[1])(pair)
    if kind == "NOT":
        return not _holds(synthetic, tree[1], pair)
    results = [_holds(synthetic, t, pair) for t in tree[1]]
    return all(results) if kind == "AND" else any(results)


def test_a_condition_selects_the_pairs_that_the_truth_selects_in_every_unit(
    client: TestClient, synthetic: Synthetic
) -> None:
    pairs = population_pairs(synthetic)
    truth = synthetic.truth

    @settings(max_examples=60)
    @given(_trees(synthetic))
    def check(tree: Tree) -> None:
        matched = [pair for pair in pairs if _holds(synthetic, tree, pair)]
        expected = {
            "biosample": sorted({b for b, _ in matched}),
            "sra-experiment": sorted({e for _, e in matched}),
            "bioproject": sorted({p for b, _ in matched for p in truth.bioprojects[b]}),
        }
        q = _text(tree)
        for unit in UNITS:
            assert accessions(client, unit, q) == expected[unit], (unit, q)

    check()
