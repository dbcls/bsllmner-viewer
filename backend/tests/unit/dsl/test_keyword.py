from __future__ import annotations

import pytest

from bsllmner_viewer.dsl.ast import BoolOp, FreeText, Node, normalize, structurally_equal
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.keyword import Accession, TextMatch, accession_kind, parts, typed_keywords, word_matches
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serializer import serialize


def _patterns(value: str, *, phrase: bool = False) -> list[tuple[str, ...]]:
    matches = word_matches(FreeText(value, is_phrase=phrase))
    assert all(isinstance(m, TextMatch) for m in matches)
    return [m.patterns for m in matches if isinstance(m, TextMatch)]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", []),
        ("   ", []),
        ("Hypoxia", ["hypoxia"]),
        ("IL-4", ["il", "4"]),
        ("CD4+", ["cd4"]),
        ("MCF-7  cells", ["mcf", "7", "cells"]),
        ("--..!!", []),
        ("a_b", ["a", "b"]),
        ("H3K27ac", ["h3k27ac"]),
        ("日本語", []),
    ],
)
def test_parts_splits_at_every_character_other_than_ascii_letters_and_digits(text: str, expected: list[str]) -> None:
    assert parts(text) == expected


@pytest.mark.parametrize(
    ("word", "kind"),
    [
        ("SAMN00000001", "biosample"),
        ("samn1", "biosample"),
        ("SAMD1", "biosample"),
        ("samea123", "biosample"),
        ("SRX1", "experiment"),
        ("drx22", "experiment"),
        ("ERX333", "experiment"),
        ("SRR1", "run"),
        ("drr22", "run"),
        ("ERR333", "run"),
        ("PRJNA1", "bioproject"),
        ("prjdb22", "bioproject"),
        ("PrjEb333", "bioproject"),
    ],
)
def test_accession_kind_recognizes_every_documented_kind_case_insensitively(word: str, kind: str) -> None:
    assert accession_kind(word) == kind


@pytest.mark.parametrize(
    "word",
    [
        "",
        "SAMN",
        "SAMX1",
        "SAMN1a",
        "SAMEA",
        "SRP1",
        "ERZ1",
        "GSM1",
        "PRJNA",
        "PRJNB1",
        "XSRX1",
        "SRX1 ",
        "SRX-1",
        "SRX1\n",
    ],
)
def test_accession_kind_without_the_exact_form_is_none(word: str) -> None:
    assert accession_kind(word) is None


def test_accession_kind_with_non_ascii_digits_is_none() -> None:
    assert accession_kind("SAMN\u0661\u0662") is None
    assert accession_kind("SRX\uff11") is None


def test_word_matches_whole_word_for_a_non_last_word() -> None:
    assert _patterns("cell line") == [("% cell %",), ("% line%",)]


def test_word_matches_last_word_also_matches_the_start_of_a_word() -> None:
    assert _patterns("organoid") == [("% organoid%",)]
    assert _patterns("H3K27") == [("% h3k27%",)]


def test_word_matches_last_word_of_one_character_matches_whole_words_only() -> None:
    assert _patterns("vitamin D") == [("% vitamin %",), ("% d %",)]
    assert _patterns("7") == [("% 7 %",)]


def test_word_matches_word_with_symbols_matches_parts_in_sequence_or_written_together() -> None:
    assert _patterns("IL-4") == [("% il 4 %", "% il4 %")]
    assert _patterns("MCF-7") == [("% mcf 7 %", "% mcf7 %")]
    assert _patterns("a-b-c") == [("% a b c %", "% abc %")]


def test_word_matches_word_with_one_part_and_a_symbol_matches_whole_words_only() -> None:
    assert _patterns("CD4+") == [("% cd4 %",)]
    assert _patterns("+CD4") == [("% cd4 %",)]
    assert _patterns("(7)") == [("% 7 %",)]


def test_word_matches_symbol_words_do_not_match_the_start_of_a_word() -> None:
    assert all(p.endswith(" %") for ps in _patterns("IL-4") for p in ps)
    assert _patterns("organoid IL-4")[-1] == ("% il 4 %", "% il4 %")


def test_word_matches_phrase_is_one_pattern_over_its_words_in_sequence() -> None:
    assert _patterns("breast  cancer", phrase=True) == [("% breast cancer %",)]
    assert _patterns("IL-4 level", phrase=True) == [("% il 4 level %",)]
    assert _patterns("organ", phrase=True) == [("% organ %",)]


def test_word_matches_phrase_ignores_accession_form() -> None:
    assert _patterns("SAMN1", phrase=True) == [("% samn1 %",)]


@pytest.mark.parametrize("value", ["", " ", "+", "--", "- -", "()"])
def test_word_matches_without_a_letter_or_digit_is_empty(value: str) -> None:
    assert word_matches(FreeText(value)) == []
    assert word_matches(FreeText(value, is_phrase=True)) == []


def test_word_matches_symbol_only_last_word_leaves_the_last_real_word_to_match_the_start() -> None:
    assert _patterns("hypoxia +") == [("% hypoxia%",)]
    assert _patterns("hypoxia - 7") == [("% hypoxia %",), ("% 7 %",)]


@pytest.mark.parametrize(
    ("word", "kind", "accession"),
    [
        ("samn1", "biosample", "SAMN1"),
        ("srx9", "experiment", "SRX9"),
        ("Err9", "run", "ERR9"),
        ("prjna5", "bioproject", "PRJNA5"),
    ],
)
def test_word_matches_accession_word_is_an_upper_case_accession(word: str, kind: str, accession: str) -> None:
    assert word_matches(FreeText(word)) == [Accession(kind, accession)]  # type: ignore[arg-type]


def test_word_matches_accession_and_text_words_are_all_required() -> None:
    matches = word_matches(FreeText("liver SAMN1 organ"))
    assert matches == [TextMatch(("% liver %",)), Accession("biosample", "SAMN1"), TextMatch(("% organ%",))]


def test_word_matches_and_or_not_are_ordinary_words() -> None:
    assert _patterns("AND") == [("% and%",)]
    assert _patterns("liver OR NOT lung") == [("% liver %",), ("% or %",), ("% not %",), ("% lung%",)]


def test_word_matches_patterns_never_hold_like_metacharacters_from_the_keyword() -> None:
    patterns = [p for ps in _patterns("50%_off a\\b") for p in ps]
    assert all(set(p) <= set("% abcdefghijklmnopqrstuvwxyz0123456789") for p in patterns)


def test_typed_keywords_of_empty_input_is_empty() -> None:
    assert typed_keywords("") == []
    assert typed_keywords("   \t ") == []


def test_typed_keywords_bare_words_form_one_keyword_and_quoted_parts_are_phrases() -> None:
    assert typed_keywords('breast "cell line" cancer') == [
        FreeText("breast cancer"),
        FreeText("cell line", is_phrase=True),
    ]
    assert typed_keywords('"a b" "c d"') == [FreeText("a b", True), FreeText("c d", True)]


def test_typed_keywords_word_the_dsl_cannot_write_bare_becomes_a_phrase() -> None:
    assert typed_keywords("HIF-1/2 liver") == [FreeText("liver"), FreeText("HIF-1/2", True)]
    assert typed_keywords("a:b") == [FreeText("a:b", True)]
    assert typed_keywords("2020-01-01") == [FreeText("2020-01-01", True)]
    assert typed_keywords("(x") == [FreeText("(x", True)]


def test_typed_keywords_and_or_not_are_ordinary_words() -> None:
    assert typed_keywords("AND OR NOT") == [FreeText("and or not")]
    assert typed_keywords("liver NOT lung") == [FreeText("liver not lung")]


@pytest.mark.parametrize("text", ["hypoxia*", "hyp?xia", "*", "a b?", "liver HIF-1*"])
def test_typed_keywords_wildcard_is_rejected(text: str) -> None:
    with pytest.raises(DslError) as info:
        typed_keywords(text)
    assert info.value.type is ErrorType.unexpected_token


@pytest.mark.parametrize("text", ["+", "-- ..", '""', '"+ -"', '"" liver'])
def test_typed_keywords_parts_without_a_letter_or_digit_are_dropped(text: str) -> None:
    assert [k.value for k in typed_keywords(text)] in ([], ["liver"])


def test_typed_keywords_unbalanced_quote_keeps_every_word() -> None:
    for text in ('"abc', 'say "hello world', 'abc"', '"', "'abc", "say 'hello world", "abc'", "'"):
        found = [p for k in typed_keywords(text) for p in parts(k.value)]
        assert sorted(found) == sorted(parts(text)), text


def test_typed_keywords_escaped_quote_in_a_phrase_is_unescaped() -> None:
    assert typed_keywords(r'"a \"b\" c"') == [FreeText('a "b" c', True)]


def test_typed_keywords_phrase_collapses_inner_whitespace() -> None:
    assert typed_keywords('"a   b\tc"') == [FreeText("a b c", True)]


def test_word_matches_words_with_a_single_quote_match_like_other_words_with_symbols() -> None:
    assert _patterns("5'-UTR") == [("% 5 utr %", "% 5utr %")]
    assert _patterns("3' end") == [("% 3 %",), ("% end%",)]
    assert _patterns("Alzheimer's") == [("% alzheimer s %", "% alzheimers %")]


def test_typed_keywords_single_quote_inside_or_at_the_end_of_a_word_is_part_of_the_word() -> None:
    assert typed_keywords("3' end") == [FreeText("3' end")]
    assert typed_keywords("5'-UTR") == [FreeText("5'-UTR")]
    assert typed_keywords("Alzheimer's disease") == [FreeText("Alzheimer's disease")]


def test_typed_keywords_word_starting_with_an_unclosed_single_quote_becomes_a_phrase() -> None:
    assert typed_keywords("'s liver") == [FreeText("liver"), FreeText("'s", True)]


def test_typed_keywords_single_quotes_at_the_start_and_the_end_of_words_make_a_phrase() -> None:
    assert typed_keywords("'cell line'") == [FreeText("cell line", True)]
    assert typed_keywords("breast 'cell line' cancer") == [FreeText("breast cancer"), FreeText("cell line", True)]
    assert typed_keywords("'Alzheimer's disease'") == [FreeText("Alzheimer's disease", True)]
    assert typed_keywords(r"'a \'b\' c'") == [FreeText("a 'b' c", True)]


def test_typed_keywords_single_quote_closes_a_phrase_only_at_the_end_of_a_word() -> None:
    assert typed_keywords("'s and Crohn's") == [FreeText("and Crohn's"), FreeText("'s", True)]
    assert typed_keywords("5' and 3'") == [FreeText("5' and 3'")]


@pytest.mark.parametrize("text", ["' '0", "' 0'", "3' end", "5'-UTR", "Alzheimer's disease", "'s", "x 'y", "'a b'"])
def test_typed_keywords_with_single_quotes_survive_serialization_alone_and_together(text: str) -> None:
    keywords = typed_keywords(text)
    assert keywords
    for keyword in keywords:
        assert structurally_equal(normalize(parse(serialize(keyword))), keyword)
    combined: Node = keywords[0] if len(keywords) == 1 else BoolOp("AND", tuple(keywords))
    assert structurally_equal(normalize(parse(serialize(combined))), normalize(combined))
