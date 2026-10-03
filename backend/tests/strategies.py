"""Hypothesis strategies shared by property-based tests."""

from __future__ import annotations

import re
from functools import reduce

from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Node, Range, clause
from bsllmner_viewer.dsl.fields import STATUS_GROUPS, STATUSES, FieldSet
from bsllmner_viewer.dsl.keyword import word_matches
from bsllmner_viewer.dsl.lex import RESERVED
from bsllmner_viewer.dsl.transform import add_clause, replace_keywords
from tests.synthetic import ANNOTATED, TARGET_ASSAYS

ANNOTATION_FIELDS = ("cell_line", "disease", "tissue", "drug")
FIELDS = FieldSet(ANNOTATION_FIELDS)

_word_chars = st.characters(
    whitelist_categories=("Lu", "Ll", "Nd"),
    whitelist_characters="-_.",
    max_codepoint=0x24F,
)
words = st.text(_word_chars, min_size=1, max_size=12).filter(lambda s: s not in ("AND", "OR", "NOT"))


def _with_apostrophe(word: str, where: str) -> str:
    if where == "start":
        return "'" + word
    if where == "end":
        return word + "'"
    middle = max(len(word) // 2, 1)
    return word[:middle] + "'" + word[middle:]


# Words with a `'` at the start, inside, or at the end, as in `'s`, `5'-UTR`, and `3'`. A `'` that starts a token
# opens a single-quoted phrase in the grammar.
apostrophe_words = st.builds(_with_apostrophe, words, st.sampled_from(("start", "inside", "end")))
phrases = st.text(
    st.characters(blacklist_categories=("Cs", "Cc"), max_codepoint=0x24F),
    min_size=1,
    max_size=20,
).filter(lambda s: s.strip() != "")
term_ids = st.builds(
    lambda p, n: f"{p}:{n:07d}", st.sampled_from(("MONDO", "UBERON", "CVCL", "CHEBI")), st.integers(0, 9_999_999)
)
dates = st.dates(
    min_value=__import__("datetime").date(2000, 1, 1), max_value=__import__("datetime").date(2030, 12, 31)
).map(lambda d: d.isoformat())


def _term_clause(field: str) -> st.SearchStrategy[FieldClause]:
    return st.builds(lambda v: FieldClause(field=field, value_kind="phrase", value=v), term_ids)


def _status_clause(field: str) -> st.SearchStrategy[FieldClause]:
    values = st.sampled_from(tuple(STATUS_GROUPS) + STATUSES)
    return st.builds(lambda v: FieldClause(field=field + "_status", value_kind="word", value=v), values)


def _date_clause() -> st.SearchStrategy[FieldClause]:
    single = st.builds(lambda d: FieldClause(field="date_published", value_kind="date", value=d), dates)
    pair = st.tuples(dates, dates).map(sorted)
    between = st.builds(
        lambda p: FieldClause(field="date_published", value_kind="range", value=Range(from_=p[0], to=p[1])),
        pair,
    )
    return st.one_of(single, between)


# Annotation clauses on any text, whose kind (`word` or `phrase`) follows from whether the value can be written bare.
text_clauses: st.SearchStrategy[FieldClause] = st.builds(
    clause, st.sampled_from(ANNOTATION_FIELDS), st.one_of(words, apostrophe_words)
)

clauses: st.SearchStrategy[FieldClause] = st.one_of(
    *[_term_clause(f) for f in ANNOTATION_FIELDS],
    *[_status_clause(f) for f in ANNOTATION_FIELDS],
    _date_clause(),
    st.builds(
        lambda v: FieldClause(field="library_strategy", value_kind="word", value=v),
        st.sampled_from(("RNA-Seq", "ChIP-Seq", "ATAC-seq")),
    ),
    st.builds(lambda v: FieldClause(field="organism_id", value_kind="word", value=str(v)), st.integers(1, 99999)),
    st.builds(lambda v: FieldClause(field="bioproject", value_kind="word", value=f"PRJNA{v}"), st.integers(1, 999999)),
)


def _bool(children: st.SearchStrategy[Node]) -> st.SearchStrategy[Node]:
    lists = st.lists(children, min_size=2, max_size=4)
    return st.one_of(
        st.builds(lambda cs: BoolOp(op="AND", children=tuple(cs)), lists),
        st.builds(lambda cs: BoolOp(op="OR", children=tuple(cs)), lists),
        st.builds(lambda c: BoolOp(op="NOT", children=(c,)), children),
    )


_date_words = st.builds(lambda d, rest: d + rest, dates, st.text(_word_chars, max_size=4))
_operator_words = st.sampled_from(sorted(RESERVED))
_operator_prefixed_words = st.builds(lambda op, rest: op + rest, _operator_words, st.text(_word_chars, max_size=4))
_keyword_words = st.one_of(words, apostrophe_words, _date_words, _operator_prefixed_words, _operator_words)


def _writable_bare(ws: list[str]) -> bool:
    """Words of a keyword that can be written bare, so the keyword is not a phrase: not first with a `'`."""
    return not ws[0].startswith("'") and not any(re.match(r"(?:AND|OR|NOT)'", w) for w in ws)


keywords: st.SearchStrategy[FreeText] = st.one_of(
    st.lists(_keyword_words, min_size=1, max_size=3).filter(_writable_bare).map(lambda ws: FreeText(" ".join(ws))),
    phrases.map(lambda p: FreeText(p, is_phrase=True)),
).filter(lambda k: bool(word_matches(k)))

asts: st.SearchStrategy[Node] = st.recursive(st.one_of(clauses, text_clauses, keywords), _bool, max_leaves=8)

# Conditions built by element selection alone: clause groups joined by AND, same-field clauses joined by OR.
flat_asts: st.SearchStrategy[Node | None] = st.lists(clauses, max_size=6).map(lambda cs: reduce(add_clause, cs, None))


UNITS = ("biosample", "sra-experiment", "bioproject")


def _phrase_clause(field: str, value: str) -> FieldClause:
    return FieldClause(field=field, value_kind="phrase", value=value)


# Clauses on the values that the synthetic dataset has, so that conditions select some of its BioSamples.
dataset_clauses = st.one_of(
    *[st.sampled_from([_phrase_clause(f, t) for t, _ in terms]) for f, terms in ANNOTATED.items()],
    st.sampled_from([_phrase_clause("library_strategy", a) for a in TARGET_ASSAYS]),
    st.sampled_from([_phrase_clause("organism_id", "9606"), _phrase_clause("organism_id", "10090")]),
    st.sampled_from(
        [
            _phrase_clause(f"{f}_status", s)
            for f in ANNOTATED
            for s in ("mapped", "unmapped", "no_value", "mapped_exact")
        ]
    ),
    st.builds(
        lambda y: FieldClause("date_published", "range", Range(f"{y}-01-01", f"{y + 3}-12-31")), st.integers(2010, 2022)
    ),
)
dataset_keywords = st.lists(
    st.sampled_from([FreeText("run1"), FreeText("cancer"), FreeText("breast cancer", True), FreeText("liver")]),
    max_size=2,
)
conditions: st.SearchStrategy[Node | None] = st.builds(
    lambda cs, ks: replace_keywords(reduce(add_clause, cs, None), ks),
    st.lists(dataset_clauses, max_size=3),
    dataset_keywords,
)
