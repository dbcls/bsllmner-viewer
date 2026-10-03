from __future__ import annotations

import re
from collections import Counter

import pytest
from hypothesis import example, given
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import BoolOp, FreeText, Node, normalize, structurally_equal
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.keyword import (
    Accession,
    TextMatch,
    accession_kind,
    keyword_text,
    parts,
    typed_keywords,
    word_matches,
)
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serializer import serialize
from bsllmner_viewer.dsl.transform import conjuncts, from_conjuncts, replace_keywords
from bsllmner_viewer.dsl.validator import validate
from tests.strategies import asts

FIELDS = FieldSet(("disease", "tissue"))

_chars = st.characters(blacklist_categories=["Cs"], max_codepoint=0x24F)
_typed = st.lists(
    st.one_of(
        st.text(_chars, max_size=8),
        st.text(st.sampled_from("ab1 -+_./\\\"'()[]:{}^~|&!"), max_size=6),
        st.sampled_from(["AND", "OR", "NOT", "2020-01-01", "SAMN1", "srx2", "IL-4", "CD4+", '"x y"', '"', '\\"']),
    ),
    max_size=6,
).map(" ".join)
_no_wildcard = _typed.filter(lambda t: "*" not in t and "?" not in t)
_keywords = st.builds(FreeText, st.text(st.sampled_from("abAB19 -+_./:"), min_size=1, max_size=12), st.booleans())


@given(_no_wildcard)
def test_typed_keywords_without_wildcards_never_raise_and_keep_every_word(text: str) -> None:
    keywords = typed_keywords(text)
    assert Counter(p for k in keywords for p in parts(k.value)) == Counter(parts(text))


@given(_no_wildcard)
@example("' '0")
@example("' 0'")
def test_typed_keywords_results_are_valid_keywords_that_survive_serialization(text: str) -> None:
    keywords = typed_keywords(text)
    for keyword in keywords:
        assert word_matches(keyword)
        validate(keyword, FIELDS)
        assert structurally_equal(normalize(parse(serialize(keyword))), keyword)
    if keywords:
        combined: Node = keywords[0] if len(keywords) == 1 else BoolOp("AND", tuple(keywords))
        again = normalize(parse(serialize(combined)))
        assert structurally_equal(again, normalize(combined))


@given(_no_wildcard)
@example("\"CD4\\\\CD8\" 'x'")
def test_keyword_text_is_read_back_as_the_same_keywords(text: str) -> None:
    keywords = typed_keywords(text)
    assert typed_keywords(keyword_text(from_conjuncts(keywords))) == keywords


@given(asts)
def test_keyword_text_keeps_every_word_of_the_top_level_keywords_of_any_condition(ast: Node) -> None:
    ast = normalize(ast)
    keywords = [c for c in conjuncts(ast) if isinstance(c, FreeText)]
    read = typed_keywords(keyword_text(ast))
    assert Counter(p for k in read for p in parts(k.value)) == Counter(p for k in keywords for p in parts(k.value))


@given(_no_wildcard, st.sampled_from(["*", "?"]), st.text("ab1", min_size=1, max_size=4))
def test_typed_keywords_rejects_an_unquoted_wildcard_anywhere(text: str, mark: str, word: str) -> None:
    with pytest.raises(DslError) as info:
        typed_keywords(f"{text} {word}{mark}")
    assert info.value.type is ErrorType.unexpected_token


@given(_no_wildcard)
def test_typed_keywords_is_stable_under_surrounding_and_repeated_whitespace(text: str) -> None:
    padded = "  " + re.sub(r" ", "   ", text) + "\t\n"
    assert typed_keywords(padded) == typed_keywords(text)


@given(_keywords)
def test_word_matches_is_case_insensitive(keyword: FreeText) -> None:
    upper = FreeText(keyword.value.upper(), keyword.is_phrase)
    lower = FreeText(keyword.value.lower(), keyword.is_phrase)
    assert word_matches(upper) == word_matches(lower)


@given(_keywords)
def test_word_matches_patterns_hold_only_lower_case_words_and_the_documented_wildcards(keyword: FreeText) -> None:
    for match in word_matches(keyword):
        if isinstance(match, Accession):
            assert accession_kind(match.accession) == match.kind
            assert match.accession == match.accession.upper()
            continue
        assert isinstance(match, TextMatch)
        for pattern in match.patterns:
            assert re.fullmatch(r"% [a-z0-9]+( [a-z0-9]+)*( %|%)", pattern), pattern


@given(_keywords)
def test_word_matches_only_the_last_word_of_a_keyword_ever_matches_a_word_start(keyword: FreeText) -> None:
    starts = [m for m in word_matches(keyword) if isinstance(m, TextMatch) and not m.patterns[0].endswith(" %")]
    assert len(starts) <= 1
    if keyword.is_phrase:
        assert not starts


@given(_keywords)
def test_word_matches_is_empty_exactly_when_the_keyword_has_no_letter_or_digit(keyword: FreeText) -> None:
    assert (word_matches(keyword) == []) == (re.search(r"[A-Za-z0-9]", keyword.value) is None)


@given(st.text(_chars, max_size=12))
def test_accession_kind_depends_only_on_the_ascii_form(word: str) -> None:
    kind = accession_kind(word)
    assert kind == accession_kind(word.upper())
    if kind is not None:
        assert re.fullmatch(r"[A-Za-z]+[0-9]+", word)


@given(asts, st.lists(_keywords, max_size=3))
def test_replace_keywords_keeps_every_other_conjunct_and_adds_the_given_keywords(
    ast: Node, keywords: list[FreeText]
) -> None:
    ast = normalize(ast)
    out = replace_keywords(ast, keywords)
    others = [c for c in conjuncts(ast) if not isinstance(c, FreeText)]
    assert [c for c in conjuncts(out) if not isinstance(c, FreeText)] == others
    assert [c for c in conjuncts(out) if isinstance(c, FreeText)] == keywords
    assert replace_keywords(out, keywords) == out
