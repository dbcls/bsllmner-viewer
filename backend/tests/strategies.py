"""Hypothesis strategies shared by property-based tests."""

from __future__ import annotations

from functools import reduce

from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, Node, Range
from bsllmner_viewer.dsl.fields import STATUS_GROUPS, STATUSES, FieldSet
from bsllmner_viewer.dsl.transform import add_clause

ANNOTATION_FIELDS = ("cell_line", "disease", "tissue", "drug")
FIELDS = FieldSet(ANNOTATION_FIELDS)

_word_chars = st.characters(
    whitelist_categories=("Lu", "Ll", "Nd"),
    whitelist_characters="-_.",
    max_codepoint=0x24F,
)
words = st.text(_word_chars, min_size=1, max_size=12).filter(lambda s: s not in ("AND", "OR", "NOT"))
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


def _value_clause(field: str) -> st.SearchStrategy[FieldClause]:
    return st.one_of(
        st.builds(lambda v: FieldClause(field=field + "_value", value_kind="word", value=v), words),
        st.builds(lambda v: FieldClause(field=field + "_value", value_kind="phrase", value=v), phrases),
    )


def _status_clause(field: str) -> st.SearchStrategy[FieldClause]:
    values = st.sampled_from(tuple(STATUS_GROUPS) + STATUSES)
    return st.builds(lambda v: FieldClause(field=field + "_status", value_kind="word", value=v), values)


def _date_clause() -> st.SearchStrategy[FieldClause]:
    single = st.builds(lambda d: FieldClause(field="date_created", value_kind="date", value=d), dates)
    pair = st.tuples(dates, dates).map(sorted)
    between = st.builds(
        lambda p: FieldClause(field="date_created", value_kind="range", value=Range(from_=p[0], to=p[1])),
        pair,
    )
    return st.one_of(single, between)


clauses: st.SearchStrategy[FieldClause] = st.one_of(
    *[_term_clause(f) for f in ANNOTATION_FIELDS],
    *[_value_clause(f) for f in ANNOTATION_FIELDS],
    *[_status_clause(f) for f in ANNOTATION_FIELDS],
    _date_clause(),
    st.builds(
        lambda v: FieldClause(field="library_strategy", value_kind="word", value=v),
        st.sampled_from(("RNA-Seq", "ChIP-Seq", "ATAC-seq")),
    ),
    st.builds(lambda v: FieldClause(field="organism_id", value_kind="word", value=str(v)), st.integers(1, 99999)),
    st.builds(lambda v: FieldClause(field="bioproject", value_kind="word", value=f"PRJNA{v}"), st.integers(1, 999999)),
    st.builds(
        lambda v: FieldClause(field="identifier", value_kind="word", value=f"SAMN{v:08d}"), st.integers(1, 99999999)
    ),
    st.builds(lambda v: FieldClause(field="title", value_kind="phrase", value=v), phrases),
)


def _bool(children: st.SearchStrategy[Node]) -> st.SearchStrategy[Node]:
    lists = st.lists(children, min_size=2, max_size=4)
    return st.one_of(
        st.builds(lambda cs: BoolOp(op="AND", children=tuple(cs)), lists),
        st.builds(lambda cs: BoolOp(op="OR", children=tuple(cs)), lists),
        st.builds(lambda c: BoolOp(op="NOT", children=(c,)), children),
    )


asts: st.SearchStrategy[Node] = st.recursive(clauses, _bool, max_leaves=8)

# Conditions built by element selection alone: clause groups joined by AND, same-field clauses joined by OR.
flat_asts: st.SearchStrategy[Node | None] = st.lists(clauses, max_size=6).map(lambda cs: reduce(add_clause, cs, None))
