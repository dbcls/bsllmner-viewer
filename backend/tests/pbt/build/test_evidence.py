from __future__ import annotations

import re
import unicodedata
from itertools import pairwise

from hypothesis import example, given
from hypothesis import strategies as st

from bsllmner_viewer.build.evidence import (
    BAG_OF_WORDS,
    CASE_INSENSITIVE,
    EXACT,
    FUZZY,
    NORMALIZED,
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
def test_trace_returns_every_matching_text_of_the_first_strategy_and_group_pair_with_a_match(
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
        differ = [(x, y) for x, y in zip(a, b, strict=True) if x != y]
        assert len(differ) == 1
        assert set(differ[0]) <= set("li1") or set(differ[0]) <= set("o0")


# Characters in both composed and decomposed forms, a combining mark alone, a Hangul syllable, and a ligature.
_unicode_pieces = st.sampled_from(
    ["e", "E", "u", "o", "a", "A", "X", "k", "1", " ", "-", "(", ")", "+", "\u00e9", "\u00c9", "e\u0301", "E\u0301",
     "\u00fc", "u\u0308", "\u00dc", "\u0301", "\ud55c", "\u1112\u1161\u11ab", "\ufb01", "\u00df", "\uff21",
     "\u01c5", "\U0001d400"]
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


@given(unicode_values, unicode_texts)
def test_find_spans_are_python_string_indexes_that_slice_the_text_to_the_value(value: str, text: str) -> None:
    for form in ("NFC", "NFD"):
        raw_value, raw_text = unicodedata.normalize(form, value), unicodedata.normalize(form, text)
        for span in find(EXACT, Text(raw_value), Text(raw_text)):
            assert raw_text[span.start : span.end] == raw_value
        for span in find(CASE_INSENSITIVE, Text(raw_value), Text(raw_text)):
            assert _fold(raw_text[span.start : span.end]) == _fold(raw_value)


def test_find_with_a_character_outside_the_bmp_counts_positions_in_code_points() -> None:
    text = "\U0001d400\U0001d400 HeLa \U0001d400 HeLa"
    assert find(EXACT, Text("HeLa"), Text(text)) == [Span(3, 7), Span(10, 14)]
    assert find(CASE_INSENSITIVE, Text("hela"), Text(text)) == [Span(3, 7), Span(10, 14)]
    assert find(NORMALIZED, Text("hela"), Text("\U0001d400 (x) he-la")) == [Span(6, 11)]


_OPENING = "([{"
_CLOSING = ")]}"
# Bracket pairs of any kind around a word that sits between the words of a value.
_name_words = st.text(st.sampled_from(list("abcdefgh")), min_size=2, max_size=5)


def _around_a_bracket_pair(words: list[str], gap: int, opening: str, closing: str, inner: str) -> tuple[str, str]:
    value = " ".join(words)
    text = " ".join(words[:gap]) + f" {opening}{inner}{closing} " + " ".join(words[gap:])
    return value, text


@given(
    st.lists(_name_words, min_size=2, max_size=4),
    st.integers(0, 10),
    st.sampled_from(list(_OPENING)),
    st.sampled_from(list(_CLOSING)),
    st.text(st.sampled_from(list("xyz")), min_size=1, max_size=4),
)
@example(["Sinoatrial", "node", "cells"], 1, "(", "]", "SAN")
@example(["Sinoatrial", "node", "cells"], 1, "[", "}", "SAN")
@example(["Sinoatrial", "node", "cells"], 1, "{", ")", "SAN")
def test_normalized_matches_a_value_around_a_bracket_pair_of_any_kinds(
    words: list[str], gap: int, opening: str, closing: str, inner: str
) -> None:
    chosen = 1 + gap % (len(words) - 1)
    value, text = _around_a_bracket_pair(words, chosen, opening, closing, inner)
    assert find(NORMALIZED, Text(value), Text(text)) == [Span(0, len(text))]


_names = st.sampled_from(["KRAS", "ABC", "TPXY"])
_upper = st.sampled_from(list("ABCDEFGHIJKLMNOPQRSTUVWXYZ"))


@given(_names, _upper, st.integers(0, 6), _upper)
def test_normalized_point_mutation_suffix_requires_one_to_four_digits_between_uppercase_letters(
    name: str, before: str, digits: int, after: str
) -> None:
    text = f"{name}{before}{'7' * digits}{after}"
    spans = find(NORMALIZED, Text(name), Text(text))
    assert spans == ([Span(0, len(name))] if 1 <= digits <= 4 else [])


@given(_names, _upper, st.integers(1, 4), _upper)
def test_normalized_point_mutation_suffix_does_not_match_a_run_with_a_lowercase_letter_or_a_trailing_letter(
    name: str, before: str, digits: int, after: str
) -> None:
    mutation = f"{before}{'7' * digits}{after}"
    assert find(NORMALIZED, Text(name), Text(f"{name}{mutation} x")) == [Span(0, len(name))]
    assert find(NORMALIZED, Text(name), Text(f"{name}{mutation.lower()} x")) == []
    assert find(NORMALIZED, Text(name), Text(f"{name}{before.lower()}{mutation[1:]} x")) == []
    assert find(NORMALIZED, Text(name), Text(f"{name}{mutation}X x")) == []


_letters = st.sampled_from(list("abc"))
_joins = st.sampled_from([" ", "+", "_"])


def _joined(letters: list[str], joins: list[str]) -> str:
    return "".join(a + b for a, b in zip(letters, [*joins, ""], strict=False))


@given(
    st.lists(_letters, min_size=2, max_size=3),
    st.lists(_letters, max_size=10),
    st.lists(_joins, min_size=10, max_size=10),
)
@example(["b", "a"], ["a", "b", "a"], [" ", "+"] + [" "] * 8)
@example(["a", "a", "b"], ["a", "b", "b"], [" "] * 10)
@example(["a", "b"], ["a", "a", "b", "a"], ["_"] * 10)
def test_find_bag_of_words_spans_hold_the_words_of_the_value_as_a_multiset_without_overlaps(
    value_words: list[str], text_words: list[str], joins: list[str]
) -> None:
    text = _joined(text_words, joins[: max(len(text_words) - 1, 0)])
    spans = find(BAG_OF_WORDS, Text(" ".join(value_words)), Text(text))
    for a, b in pairwise(spans):
        assert a.end <= b.start
    for span in spans:
        assert sorted(re.findall("[abc]", text[span.start : span.end])) == sorted(value_words)
        assert text[span.start] in "abc"
        assert text[span.end - 1] in "abc"
    if sorted(text_words[: len(value_words)]) == sorted(value_words):
        assert spans != []


def test_find_bag_of_words_with_overlapping_windows_keeps_the_first() -> None:
    text = "a b+a"
    assert [text[s.start : s.end] for s in find(BAG_OF_WORDS, Text("b a"), Text(text))] == ["a b"]


_vocabulary = ["erythroid", "cabozantinib", "progenitor", "lymphocyte", "fibroblast", "hepatocyte"]


def _misspelled(word: str) -> str:
    middle = len(word) // 2
    return word[:middle] + "q" + word[middle + 1 :]


@given(
    st.lists(st.sampled_from(_vocabulary), min_size=1, max_size=3, unique=True),
    st.lists(st.booleans(), min_size=3, max_size=3),
    st.lists(st.sampled_from([*_vocabulary, "and", "of"]), max_size=3),
    st.lists(st.sampled_from([*_vocabulary, "and", "of"]), max_size=3),
)
@example(["erythroid", "cabozantinib"], [False, False, False], [], [])
@example(["erythroid", "cabozantinib"], [True, False, False], [], [])
def test_find_fuzzy_spans_have_the_words_of_the_value_in_order_and_differ_in_at_least_one_word(
    value_words: list[str], mutate: list[bool], before: list[str], after: list[str]
) -> None:
    middle = [_misspelled(w) if m else w for w, m in zip(value_words, mutate, strict=False)]
    text = " ".join([*before, *middle, *after])
    for span in find(FUZZY, Text(" ".join(value_words)), Text(text)):
        found = text[span.start : span.end].split()
        assert len(found) == len(value_words)
        assert all(similar(a, b) for a, b in zip(found, value_words, strict=True))
        assert found != value_words


@given(
    st.lists(st.sampled_from(_vocabulary), min_size=2, max_size=3, unique=True),
    st.sampled_from(["and", "of"]),
)
def test_find_fuzzy_does_not_match_a_reordered_shorter_or_interleaved_word_sequence(
    value_words: list[str], extra: str
) -> None:
    value = Text(" ".join(value_words))
    misspelled = [_misspelled(w) for w in value_words]
    assert find(FUZZY, value, Text(" ".join(misspelled))) != []
    reordered = [*misspelled[1:], misspelled[0]]
    assert find(FUZZY, value, Text(" ".join(reordered))) == []
    for dropped in range(len(misspelled)):
        shorter = [w for i, w in enumerate(misspelled) if i != dropped]
        assert find(FUZZY, value, Text(" ".join(shorter))) == []
    for gap in range(1, len(misspelled)):
        interleaved = [*misspelled[:gap], extra, *misspelled[gap:]]
        assert find(FUZZY, value, Text(" ".join(interleaved))) == []


_confusable_groups = ["li1", "o0"]
_plain = st.text(st.sampled_from(list("abcdefxyz")), max_size=12)


@given(_plain, _plain, st.sampled_from(_confusable_groups), st.data())
def test_similar_holds_after_replacing_a_character_with_a_confusable_one_of_its_group(
    head: str, tail: str, group: str, data: st.DataObject
) -> None:
    original = data.draw(st.sampled_from(list(group)))
    replacement = data.draw(st.sampled_from([c for c in group if c != original]))
    assert similar(head + original + tail, head + replacement + tail)
    assert similar(head + replacement + tail, head + original + tail)


@given(st.text(st.sampled_from(list("abcdefxyz")), max_size=2), st.text(st.sampled_from(list("abcdefxyz")), max_size=2))
@example("", "")
def test_similar_does_not_hold_after_replacing_a_character_with_one_of_another_group_in_a_short_word(
    head: str, tail: str
) -> None:
    for first in "li1":
        for second in "o0":
            assert not similar(head + first + tail, head + second + tail)


def _levenshtein(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[-1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def _limit(shorter: int) -> int:
    if shorter < 6:
        return 0
    if shorter < 8:
        return 1
    if shorter < 14:
        return 2
    return 3


_edit = st.tuples(st.sampled_from("sid"), st.integers(0, 40), st.sampled_from(list("abcdefxy")))


@st.composite
def _word_pairs(draw: st.DrawFn) -> tuple[str, str]:
    base = draw(st.text(st.sampled_from(list("abcdefxy")), min_size=6, max_size=16))
    word = list(base)
    for op, at, char in draw(st.lists(_edit, min_size=1, max_size=3)):
        at = at % (len(word) + 1)
        if op == "i":
            word.insert(at, char)
        elif word and op == "d":
            del word[min(at, len(word) - 1)]
        elif word:
            word[min(at, len(word) - 1)] = char
    return base, "".join(word)


@given(_word_pairs())
@example(("abcdefg", "abcdexy"))
@example(("abcdefghijklm", "abcdefghijkxy"))
@example(("abcdefghijklm", "abcdefghijxyz"))
@example(("abcdefgh", "abcdefg"))
@example(("abcdef", "abcdeg"))
@example(("abcdef", "abcdgh"))
@example(("abcdefgh", "abcdefxy"))
@example(("abcdefgh", "abcdexyz"))
@example(("abcdefghijklmn", "abcdefghijkxyz"))
@example(("abcdefghijklmn", "abcdefghijwxyz"))
@example(("abcde", "abcdf"))
def test_similar_equals_a_levenshtein_distance_within_the_limit_of_the_shorter_word(pair: tuple[str, str]) -> None:
    a, b = pair
    if a == b:
        return
    assert similar(a, b) == (_levenshtein(a, b) <= _limit(min(len(a), len(b))))
