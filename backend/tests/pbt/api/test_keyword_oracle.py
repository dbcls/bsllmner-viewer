"""Keywords against the synthetic store, compared with an oracle written from the rules of docs/api.md.

The oracle reads the raw values of the BioSamples and the accessions of the population. It does not use the
searchable-text table or any code of `bsllmner_viewer.dsl.keyword`.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass

import duckdb
import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.api_helpers import accessions, count
from tests.strategies import UNITS

Row = tuple[str, str]
Predicate = Callable[[str, str], bool]

SYMBOL_WORDS = [
    "MCF-7", "MCF7", "mcf-7", "K-562", "K562", "k-562", "IL-4", "IL4", "CD4+", "T-cell", "HepG2", "Hep-G2", "H3K27ac",
    "H3K27", "BRD4-38", "brd4", "+", "a-", "-a", "7+", "+7", "k.562",
]  # fmt: skip
RESERVED = {"AND", "OR", "NOT"}


@dataclass(frozen=True)
class Corpus:
    values: dict[str, list[str]]
    rows: list[Row]
    runs: dict[str, set[str]]
    projects: dict[str, set[str]]

    def accessions(self) -> dict[str, list[str]]:
        return {
            "biosample": sorted({b for b, _ in self.rows}),
            "experiment": sorted({e for _, e in self.rows}),
            "run": sorted({r for rs in self.runs.values() for r in rs}),
            "bioproject": sorted({p for b, _ in self.rows for p in self.projects.get(b, ())}),
        }


@pytest.fixture(scope="module")
def corpus(store_con: duckdb.DuckDBPyConnection) -> Corpus:
    values: dict[str, list[str]] = {}
    for accession, title, organism, description, attributes in store_con.execute(
        "SELECT accession, title, organism_name, description, attributes FROM biosample"
    ).fetchall():
        values[accession] = (
            [v for v in (title, organism) if v]
            + [d["value"] for d in json.loads(description)]
            + [a["value"] for a in json.loads(attributes)]
        )
    for accession, extracted, label in store_con.execute(
        "SELECT biosample, extracted_value, term_label FROM annotation"
    ).fetchall():
        values[accession] += [v for v in (extracted, label) if v]
    runs: dict[str, set[str]] = {}
    for run, experiment in store_con.execute("SELECT accession, experiment FROM sra_run").fetchall():
        runs.setdefault(experiment, set()).add(run)
    projects: dict[str, set[str]] = {}
    for biosample, project in store_con.execute("SELECT biosample, bioproject FROM biosample_bioproject").fetchall():
        projects.setdefault(biosample, set()).add(project)
    rows = [(b, e) for b, e in store_con.execute("SELECT biosample, experiment FROM population").fetchall()]
    return Corpus(values, rows, runs, projects)


def tokens(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", value.lower())


def joined_forms(value: str) -> list[str]:
    forms = []
    for chunk in value.lower().split():
        for found in re.finditer(r"[a-z0-9]+(?:[^a-z0-9]+[a-z0-9]+)+", chunk):
            forms.append("".join(tokens(found.group())))
    return forms


def _in_sequence(needle: list[str], sequences: list[list[str]]) -> bool:
    n = len(needle)
    return any(seq[i : i + n] == needle for seq in sequences for i in range(len(seq) - n + 1))


def atom(corpus: Corpus, value: str, *, phrase: bool) -> Predicate:
    """The documented rules of one keyword, as a predicate over a row (BioSample, experiment)."""
    sequences = {b: [tokens(v) for v in vs] for b, vs in corpus.values.items()}
    wordsets = {
        b: {w for seq in seqs for w in seq} | {f for v in corpus.values[b] for f in joined_forms(v)}
        for b, seqs in sequences.items()
    }
    if phrase:
        needle = tokens(value)
        return lambda b, e: _in_sequence(needle, sequences[b])
    words = value.split()
    last = max(i for i, w in enumerate(words) if tokens(w))
    checks: list[tuple[str, str | list[str]]] = []
    for index, word in enumerate(words):
        parts = tokens(word)
        if not parts:
            continue
        upper = word.upper()
        if re.fullmatch(r"SAM(N|D|EA)[0-9]+", upper):
            checks.append(("biosample", upper))
        elif re.fullmatch(r"[SDE]RX[0-9]+", upper):
            checks.append(("experiment", upper))
        elif re.fullmatch(r"[SDE]RR[0-9]+", upper):
            checks.append(("run", upper))
        elif re.fullmatch(r"PRJ(NA|DB|EB)[0-9]+", upper):
            checks.append(("bioproject", upper))
        elif len(parts) > 1:
            checks.append(("parts", parts))
        elif index == last and re.search(r"[^A-Za-z0-9]", word) is None and len(parts[0]) > 1:
            checks.append(("start", parts[0]))
        else:
            checks.append(("whole", parts[0]))

    def holds(biosample: str, experiment: str) -> bool:
        for kind, payload in checks:
            if kind == "biosample":
                ok = biosample.upper() == payload
            elif kind == "experiment":
                ok = experiment.upper() == payload
            elif kind == "run":
                ok = payload in {r.upper() for r in corpus.runs.get(experiment, ())}
            elif kind == "bioproject":
                ok = payload in {p.upper() for p in corpus.projects.get(biosample, ())}
            elif kind == "parts":
                assert isinstance(payload, list)
                ok = _in_sequence(payload, sequences[biosample]) or "".join(payload) in wordsets[biosample]
            elif kind == "start":
                ok = any(w.startswith(str(payload)) for w in wordsets[biosample])
            else:
                ok = payload in wordsets[biosample]
            if not ok:
                return False
        return True

    return holds


def _quote(value: str) -> str:
    return '"' + value + '"'


@dataclass(frozen=True)
class Atom:
    text: str
    value: str
    phrase: bool


def _swap(draw: st.DrawFn, word: str) -> str:
    return draw(st.sampled_from([word, word.upper(), word.lower(), word.title()]))


@st.composite
def atoms(draw: st.DrawFn, corpus: Corpus) -> Atom:
    vocabulary = sorted({t for vs in corpus.values.values() for v in vs for t in tokens(v)})
    accessions = corpus.accessions()
    if draw(st.integers(0, 3)) == 0:
        value = draw(st.sampled_from(sorted(corpus.values)))
        sequences = [tokens(v) for v in corpus.values[value] if tokens(v)]
        sequence = draw(st.sampled_from(sequences))
        start = draw(st.integers(0, len(sequence) - 1))
        size = draw(st.integers(1, 4))
        words = sequence[start : start + size]
        if draw(st.booleans()):
            # the same words in another order or with a gap, which must not match as a phrase
            words = draw(st.permutations(words))
        phrase = " ".join(words)
        return Atom(_quote(phrase), phrase, True)
    chosen: list[str] = []
    for _ in range(draw(st.integers(1, 3))):
        kind = draw(st.sampled_from(["token", "token", "prefix", "symbol", "accession"]))
        if kind == "token":
            word = draw(st.sampled_from(vocabulary))
        elif kind == "prefix":
            word = draw(st.sampled_from(vocabulary))
            word = word[: draw(st.integers(1, len(word)))]
        elif kind == "symbol":
            word = draw(st.sampled_from(SYMBOL_WORDS))
        else:
            word = draw(st.sampled_from(accessions[draw(st.sampled_from(sorted(accessions)))] or ["SAMN1"]))
        word = _swap(draw, word)
        if word.upper() in RESERVED:
            word = word + "x"
        chosen.append(word)
    if not any(tokens(w) for w in chosen):
        chosen.append(draw(st.sampled_from(vocabulary)))
    text = " ".join(chosen)
    return Atom(text, text, False)


def _evaluate(corpus: Corpus, q: str, row_predicate: Predicate) -> dict[str, set[str]]:
    matching = [(b, e) for b, e in corpus.rows if row_predicate(b, e)]
    return {
        "biosample": {b for b, _ in matching},
        "sra-experiment": {e for _, e in matching},
        "bioproject": {p for b, _ in matching for p in corpus.projects.get(b, ())},
    }


def _fetch(client: TestClient, q: str) -> dict[str, set[str]]:
    return {unit: set(accessions(client, unit, q)) for unit in UNITS}


def _combine(corpus: Corpus, form: str, a: Atom, b: Atom) -> tuple[str, Predicate]:
    pa = atom(corpus, a.value, phrase=a.phrase)
    pb = atom(corpus, b.value, phrase=b.phrase)
    if form == "single":
        return a.text, pa
    if form == "not":
        return f"NOT {a.text}", lambda r, e: not pa(r, e)
    if form == "and":
        return f"{a.text} AND {b.text}", lambda r, e: pa(r, e) and pb(r, e)
    if form == "or":
        return f"{a.text} OR {b.text}", lambda r, e: pa(r, e) or pb(r, e)
    if form == "and_not":
        return f"{a.text} AND NOT {b.text}", lambda r, e: pa(r, e) and not pb(r, e)
    return f"NOT ({a.text} OR {b.text})", lambda r, e: not (pa(r, e) or pb(r, e))


@settings(max_examples=120)
@given(data=st.data())
def test_keyword_condition_matches_the_entries_the_documented_rules_select(
    client: TestClient, corpus: Corpus, data: st.DataObject
) -> None:
    form = data.draw(st.sampled_from(["single", "single", "not", "and", "or", "and_not", "not_or"]))
    a = data.draw(atoms(corpus))
    b = data.draw(atoms(corpus))
    q, predicate = _combine(corpus, form, a, b)
    expected = _evaluate(corpus, q, predicate)
    assert _fetch(client, q) == expected, q


@settings(max_examples=40)
@given(data=st.data())
def test_keyword_counts_of_biosamples_and_experiments_equal_the_number_of_matching_accessions(
    client: TestClient, corpus: Corpus, data: st.DataObject
) -> None:
    a = data.draw(atoms(corpus))
    expected = _evaluate(corpus, a.text, atom(corpus, a.value, phrase=a.phrase))
    assert count(client, a.text) == len(expected["biosample"]), a.text
    assert count(client, a.text, "sra-experiment") == len(expected["sra-experiment"]), a.text


@pytest.mark.parametrize(
    "q",
    [
        "MCF-7",
        "MCF7",
        "mcf-7",
        "mcf",
        "mc",
        "m",
        "mcf-",
        "K562",
        "k-562",
        "K56",
        "IL-4",
        "CD4+",
        "HepG2",
        "H3K27",
        "breast disorder",
        '"breast disorder"',
        '"disorder breast"',
        "disorder breast",
        '"mcf 7"',
        '"mcf 7 treated"',
        "treated",
        "treate",
        "treated samn01000000",
        "SAMN01000000",
        "samn01000000",
        "SAMN0100000",
        "SRX0000001",
        "srx0000001",
        "SRX000000",
        "SRR00000010",
        "srr00000010",
        "PRJNA000009",
        "prjna000009",
        "PRJNA00000",
        "SAMN01000000 SRX0000001",
        "SAMN01000000 SRX0000002",
        "SAMN01000001 SRX0000001",
        "sample of",
        "samn0100000",
        "sample 1",
        "homo sapiens",
        '"homo sapiens"',
        "sapiens homo",
        '"sapiens sample"',
        "cell line",
        "lung 51",
        '"lung 51"',
        "51 lung",
        "a",
        "7",
    ],
)
def test_keyword_documented_examples_match_the_oracle(client: TestClient, corpus: Corpus, q: str) -> None:
    phrase = q.startswith('"')
    expected = _evaluate(corpus, q, atom(corpus, q.strip('"'), phrase=phrase))
    assert _fetch(client, q) == expected, q


@pytest.mark.parametrize(
    ("q", "left", "right"),
    [
        ("NOT mcf7", "mcf7", None),
        ("mcf7 AND NOT liver", "mcf7", "liver"),
        ("liver OR lung", "liver", "lung"),
    ],
)
def test_keyword_boolean_examples_match_the_oracle(
    client: TestClient, corpus: Corpus, q: str, left: str, right: str | None
) -> None:
    pa = atom(corpus, left, phrase=False)
    pb = atom(corpus, right, phrase=False) if right else pa

    def predicate(b: str, e: str) -> bool:
        if q.startswith("NOT"):
            return not pa(b, e)
        if " AND NOT " in q:
            return pa(b, e) and not pb(b, e)
        return pa(b, e) or pb(b, e)

    assert _fetch(client, q) == _evaluate(corpus, q, predicate), q


def test_oracle_corpus_has_the_words_the_examples_rely_on(corpus: Corpus) -> None:
    words = {t for vs in corpus.values.values() for v in vs for t in tokens(v)}
    forms = {f for vs in corpus.values.values() for v in vs for f in joined_forms(v)}
    assert {"mcf", "7", "treated", "breast", "disorder", "sapiens"} <= words
    assert {"mcf7", "k562"} <= forms
    assert corpus.rows
    assert all(corpus.accessions()[kind] for kind in ("biosample", "experiment", "run", "bioproject"))


@pytest.mark.parametrize(
    "q",
    [
        "MCF7",
        "mcf-7",
        "K562",
        "mcf",
        "mcf-",
        "7 lung",
        "breast disorder",
        '"breast disorder"',
        "SRX0000001",
        "PRJNA000009",
        "SRR00000010",
    ],
)
def test_oracle_finds_matches_for_the_words_that_occur_in_the_data(corpus: Corpus, q: str) -> None:
    expected = _evaluate(corpus, q, atom(corpus, q.strip('"'), phrase=q.startswith('"')))
    assert expected["biosample"]
    assert expected["sra-experiment"]


@pytest.mark.parametrize("q", ["SAMN0100000", "SRX000000", "PRJNA00000", '"sapiens sample"', '"disorder breast"'])
def test_oracle_finds_no_match_where_the_rules_forbid_one(corpus: Corpus, q: str) -> None:
    expected = _evaluate(corpus, q, atom(corpus, q.strip('"'), phrase=q.startswith('"')))
    assert expected["biosample"] == set()
