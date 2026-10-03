from __future__ import annotations

import re
import unicodedata
from itertools import pairwise

from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.build.evidence import (
    CASE_INSENSITIVE,
    EXACT,
    SHORT_VALUE,
    TEXT_STRATEGIES,
    Span,
    Text,
    _is_continuation,
    find,
    similar,
    trace,
)
from bsllmner_viewer.store.metadata import EvidenceStrategy

# Letters that differ in case, digits, separators, brackets, a letter that folds to two letters, and a full-width
# letter that folds to ASCII.
texts = st.text(st.sampled_from(list("abAB01 -_()/.\u00df\uff21")), max_size=30)
values = st.text(st.sampled_from(list("abAB01 -()\u00df")), min_size=1, max_size=6)
words = st.text(st.sampled_from(list("abilo01")), min_size=1, max_size=9)


def _fold(text: str) -> str:
    return "".join(unicodedata.normalize("NFKC", ch).casefold() for ch in text)


def _cuts_a_word(text: str, span: Span) -> bool:
    return (text[span.start].isalnum() and span.start > 0 and text[span.start - 1].isalnum()) or (
        text[span.end - 1].isalnum() and span.end < len(text) and text[span.end].isalnum()
    )


@given(st.sampled_from(TEXT_STRATEGIES), values, texts)
def test_find_returns_spans_inside_the_text_in_order_without_overlaps(
    strategy: EvidenceStrategy, value: str, text: str
) -> None:
    spans = find(strategy, Text(value), Text(text))
    assert all(0 <= s.start < s.end <= len(text) for s in spans)
    assert all(a.end <= b.start for a, b in pairwise(spans))


@given(values, texts)
def test_exact_spans_are_the_value_and_do_not_cut_a_word(value: str, text: str) -> None:
    for span in find(EXACT, Text(value), Text(text)):
        assert text[span.start : span.end] == value
        assert not _cuts_a_word(text, span)


@given(values, texts)
def test_case_insensitive_spans_fold_to_the_folded_value_and_do_not_cut_a_word(value: str, text: str) -> None:
    for span in find(CASE_INSENSITIVE, Text(value), Text(text)):
        assert _fold(text[span.start : span.end]) == _fold(value)
        assert not _cuts_a_word(text, span)


@given(texts)
def test_folded_text_is_the_folding_of_each_character_and_points_back_to_it(text: str) -> None:
    folded, origin = Text(text).folded()
    assert folded == _fold(text)
    assert len(origin) == len(folded)
    assert all(folded[i] in _fold(text[origin[i]]) for i in range(len(folded)))
    assert origin == sorted(origin)


@given(texts, st.text(st.sampled_from(list("abAB01-()")), min_size=1, max_size=6), texts)
def test_trace_finds_a_value_between_spaces_with_exact(before: str, value: str, after: str) -> None:
    text = f"{before} {value} {after}"
    traced = trace(value, [[Text(text)]])
    assert traced is not None
    assert traced.strategy == EXACT
    assert any(text[m.span.start : m.span.end] == value for m in traced.matches)


@given(values, st.lists(st.lists(texts, max_size=3), min_size=1, max_size=2))
def test_trace_returns_every_text_that_matches_with_the_first_strategy_and_group_that_match(
    value: str, groups: list[list[str]]
) -> None:
    prepared = [[Text(t) for t in group] for group in groups]
    query = Text(value.strip())
    strategies = TEXT_STRATEGIES if len(query.raw) >= SHORT_VALUE else (EXACT,)
    hits = [
        (strategy, index)
        for strategy in strategies
        for index, texts_of_group in enumerate(prepared)
        if any(find(strategy, query, t) for t in texts_of_group)
    ]
    traced = trace(value, prepared)
    if traced is None:
        assert hits == []
        return
    assert (traced.strategy, traced.group) == hits[0]
    matching = {at for at, t in enumerate(prepared[traced.group]) if find(traced.strategy, query, t)}
    assert {m.text for m in traced.matches} == matching


@given(words, words)
def test_similar_is_reflexive_and_symmetric(a: str, b: str) -> None:
    assert similar(a, a)
    assert similar(a, b) == similar(b, a)


@given(words, words)
def test_similar_words_with_different_digits_differ_in_one_confusable_character(a: str, b: str) -> None:
    if similar(a, b) and re.findall(r"\d+", a) != re.findall(r"\d+", b):
        differ = [(x, y) for x, y in zip(a, b, strict=False) if x != y]
        assert len(a) == len(b)
        assert len(differ) == 1
        assert set(differ[0]) <= set("li1") or set(differ[0]) <= set("o0")


@given(words, words)
def test_similar_words_shorter_than_six_characters_differ_at_most_in_one_confusable_character(a: str, b: str) -> None:
    if min(len(a), len(b)) < 6 and a != b and similar(a, b):
        assert len(a) == len(b)
        assert sum(x != y for x, y in zip(a, b, strict=True)) == 1


# Characters in both composed and decomposed forms, a combining mark alone, a Hangul syllable, and a ligature.
_unicode_pieces = st.sampled_from(
    ["e", "E", "u", "o", "a", "A", "X", "k", "1", " ", "-", "(", ")", "+", "\u00e9", "\u00c9", "e\u0301", "E\u0301",
     "\u00fc", "u\u0308", "\u00dc", "\u0301", "\ud55c", "\u1112\u1161\u11ab", "\ufb01", "\u00df", "\uff21", "\u01c5"]
)  # fmt: skip
unicode_texts = st.lists(_unicode_pieces, max_size=14).map("".join)
unicode_values = st.lists(_unicode_pieces, min_size=1, max_size=6).map("".join)


def _summary(value: str, text: str) -> tuple[str, int, int] | None:
    traced = trace(value, [[Text(text)]])
    return None if traced is None else (traced.strategy, traced.group, len(traced.matches))


@given(unicode_values, unicode_texts)
def test_trace_strategy_does_not_change_when_the_value_and_the_text_are_both_composed_or_both_decomposed(
    value: str, text: str
) -> None:
    composed = _summary(unicodedata.normalize("NFC", value), unicodedata.normalize("NFC", text))
    decomposed = _summary(unicodedata.normalize("NFD", value), unicodedata.normalize("NFD", text))
    assert composed == decomposed


@given(st.sampled_from(TEXT_STRATEGIES), unicode_values, unicode_texts)
def test_find_spans_start_and_end_between_units(strategy: EvidenceStrategy, value: str, text: str) -> None:
    for form in ("NFC", "NFD"):
        normalized = unicodedata.normalize(form, text)
        for span in find(strategy, Text(unicodedata.normalize(form, value)), Text(normalized)):
            assert span.start == 0 or not _is_continuation(normalized[span.start])
            assert span.end == len(normalized) or not _is_continuation(normalized[span.end])
