from __future__ import annotations

import unicodedata
from collections.abc import Callable

import pytest

from bsllmner_viewer.build.evidence import (
    BAG_OF_WORDS,
    CASE_INSENSITIVE,
    EXACT,
    FUZZY,
    NORMALIZED,
    ONTOLOGY_SYNONYM,
    TEXT_STRATEGIES,
    Text,
    find,
    similar,
    trace,
    trace_term,
)


def _traced(value: str, text: str) -> tuple[str, list[str]] | None:
    """The strategy and the matched substrings of a value in one text."""
    traced = trace(value, [[Text(text)]])
    if traced is None:
        return None
    return traced.strategy, [text[m.span.start : m.span.end] for m in traced.matches]


@pytest.mark.parametrize(
    ("value", "text", "strategy", "matched"),
    [
        ("DLD-1", "DLD-1 cell line", EXACT, "DLD-1"),
        ("HeLa", "Hela-S3", CASE_INSENSITIVE, "Hela"),
        ("CUDC-101", "CUDC 101", NORMALIZED, "CUDC 101"),
        ("LSD1 inhibitor", "Inhibitor_LSD1", BAG_OF_WORDS, "Inhibitor_LSD1"),
        ("erythroid", "Erytrhoid progenitor", FUZZY, "Erytrhoid"),
        ("CD45 positive cell", "CD45 positiv cell", FUZZY, "CD45 positiv cell"),
    ],
)
def test_trace_finds_the_examples_of_each_strategy_with_that_strategy(
    value: str, text: str, strategy: str, matched: str
) -> None:
    assert _traced(value, text) == (strategy, [matched])


@pytest.mark.parametrize(
    ("value", "text", "matched"),
    [
        ("Sinoatrial node cells", "Sinoatrial node (SAN) cells", "Sinoatrial node (SAN) cells"),
        ("HEK293", "HEK 293T and HEK 293", "HEK 293"),
        ("lung carcinoma", "lung (carcinoma) cell line", "lung (carcinoma)"),
        ("carcinoma cell line", "lung (carcinoma) cell line", "(carcinoma) cell line"),
        ("Whsc1", "ChIPseq and RNAseq in Whsc1KO E12.5 heart", "Whsc1"),
        ("Kras", "KrasG12D mice", "Kras"),
        ("BRD9", "shBRD9 cells", "BRD9"),
        ("Rb1", "sgNT;sgRb1;sgTrp53", "Rb1"),
        ("ESC", "human ESCs", "ESC"),
        ("Neurod1", "Ngn3KONgn3CreNeurod1OE_E15.5", "Neurod1"),
        ("STAT3", "JC5068_pSTAT3_siFOXA1", "STAT3"),
        ("Lyn", "LynBKO BMDMs", "Lyn"),
        ("Trsp", "TrspN2_CR", "Trsp"),
    ],
)
def test_normalized_matches_separators_brackets_genotype_affixes_and_case_changes_and_keeps_brackets_balanced(
    value: str, text: str, matched: str
) -> None:
    assert _traced(value, text) == (NORMALIZED, [matched])


@pytest.mark.parametrize(
    ("value", "text"),
    [
        ("ATM", "DMSO treatment for 24h"),
        ("REST", "tissue of interest"),
        ("Nrf1", "Nrf12 knockout"),
        ("HIF-1a", "HIF-1alpha"),
        ("HIF-1a", "HIF-2a"),
        ("in vitro", "cultured in vitrogen media"),
        ("ADAMTS13", "ADAMTS12 overexpression"),
        ("TP53", "TP53BP1 knockdown"),
        ("Gata1", "Gata1OEHZ"),
        ("STAT3", "pstat3"),
        ("MCF7", "MCF7L parental"),
        ("NO", "No dairy. Limited soy"),
        ("S", "https://example.org"),
    ],
)
def test_trace_does_not_match_a_value_inside_a_longer_word_or_a_different_identifier(value: str, text: str) -> None:
    assert _traced(value, text) is None


def test_exact_matches_a_short_value_at_word_boundaries_and_nothing_else_matches_it() -> None:
    assert _traced("AR", "AR knockdown") == (EXACT, ["AR"])
    assert _traced("AR", "ar knockdown") is None
    assert _traced("B6", "strain C57BL/6 (B6)") == (EXACT, ["B6"])


def test_bag_of_words_and_fuzzy_tell_a_sign_after_a_word_apart() -> None:
    assert _traced("CD19+ Long-Lived Plasma Cells", "CD19- Long-Lived Plasma Cells") is None
    assert _traced("plasma cells CD19+", "CD19+ plasma cells") == (BAG_OF_WORDS, ["CD19+ plasma cells"])
    assert _traced("Long Lived plasma", "plasma Long-Lived") == (BAG_OF_WORDS, ["plasma Long-Lived"])
    assert _traced("GM-CSF", "GM+CSF") == (BAG_OF_WORDS, ["GM+CSF"])
    assert _traced("Cabozantinib", "Cabozanitnib+IL-27") == (FUZZY, ["Cabozanitnib"])


def test_word_boundaries_apply_only_to_an_edge_that_is_a_letter_or_a_digit() -> None:
    assert _traced("CD4+", "CD4+CD8+ T cells") == (EXACT, ["CD4+"])
    assert _traced("CD4", "CD4+CD8+ T cells") == (EXACT, ["CD4"])


def test_case_insensitive_folds_unicode_compatibility_forms_and_matches_only_whole_characters() -> None:
    assert _traced("MCF7", "\uff2d\uff23\uff26\uff17 cells") == (CASE_INSENSITIVE, ["\uff2d\uff23\uff26\uff17"])
    assert _traced("STRASSE", "Straße 1") == (CASE_INSENSITIVE, ["Straße"])
    assert _traced("STRAS", "Straße 1") is None


def test_fuzzy_accepts_one_confusable_character_in_a_word_of_any_length() -> None:
    assert _traced("DNase I", "treated with DNase l") == (FUZZY, ["DNase l"])
    assert similar("ii", "il")
    assert not similar("ab", "ac")


def test_fuzzy_scales_the_distance_with_the_length_of_the_shorter_word() -> None:
    assert similar("abcdef", "abcdeg")
    assert not similar("abcdef", "abcdgh")
    assert similar("abcdefgh", "abcdefxy")
    assert not similar("abcdefgh", "abcdexyz")
    assert similar("abcdefghijklmn", "abcdefghijkxyz")
    assert not similar("abcdefghijklmn", "abcdefghijwxyz")
    assert not similar("abcde", "abcdf")


def test_fuzzy_requires_the_same_digits_and_allows_one_edit_in_a_word_with_digits() -> None:
    assert similar("smarcb1", "smarcc1")
    assert not similar("smarcb1", "smarcb2")
    assert not similar("abcdefgh12", "abcdefxy12")


def test_trace_returns_every_occurrence_in_every_text_of_the_matching_group() -> None:
    texts = [Text("HeLa and HeLa"), Text("ChIP-seq of HeLa cells"), Text("HEK293")]
    traced = trace("HeLa", [texts])
    assert traced is not None
    assert traced.strategy == EXACT
    assert [(m.text, m.span.start) for m in traced.matches] == [(0, 0), (0, 9), (1, 12)]


def test_trace_searches_the_second_group_only_when_the_first_has_no_match_with_the_same_strategy() -> None:
    first, second = [Text("cell line: HeLa")], [Text("HeLa_ChIP_rep1")]
    traced = trace("HeLa", [first, second])
    assert traced is not None
    assert (traced.strategy, traced.group) == (EXACT, 0)
    traced = trace("HeLa", [[Text("hela cells")], second])
    assert traced is not None
    assert (traced.strategy, traced.group) == (EXACT, 1)


def test_trace_ignores_whitespace_around_the_value() -> None:
    assert _traced(" HeLa ", "HeLa cells") == (EXACT, ["HeLa"])
    assert _traced("   ", "HeLa cells") is None


def _term_matches(names: list[str], groups: list[list[Text]]) -> tuple[int, list[tuple[int, str]]] | None:
    traced = trace_term(names, groups)
    if traced is None:
        return None
    assert traced.strategy == ONTOLOGY_SYNONYM
    texts = groups[traced.group]
    return traced.group, [(m.text, texts[m.text].raw[m.span.start : m.span.end]) for m in traced.matches]


def test_trace_term_tries_every_name_with_a_strategy_before_the_next_strategy() -> None:
    texts = [Text("treated with doxorubicine"), Text("adriamycin 1 uM")]
    assert _term_matches(["doxorubicin", "adriamycin"], [texts]) == (0, [(1, "adriamycin")])


def test_trace_term_searches_a_later_group_only_when_no_name_matches_an_earlier_one_with_the_strategy() -> None:
    values, names = [Text("Breast tumor-derived")], [Text("breast tumor grade")]
    assert _term_matches(["breast cancer", "breast tumor"], [values, names]) == (1, [(0, "breast tumor")])
    assert _term_matches(["breast cancer", "Breast tumor"], [values, names]) == (0, [(0, "Breast tumor")])


def test_trace_term_searches_a_short_name_only_with_exact() -> None:
    assert trace_term(["nitric oxide", "NO"], [[Text("No dairy")]]) is None
    assert _term_matches(["nitric oxide", "NO"], [[Text("NO donor")]]) == (0, [(0, "NO")])


def test_trace_term_keeps_the_matches_of_every_name_without_overlaps() -> None:
    found = _term_matches(["breast cancer", "mammary cancer", "cancer"], [[Text("breast cancer, a mammary cancer")]])
    assert found == (0, [(0, "breast cancer"), (0, "mammary cancer")])


def test_the_strategy_type_names_every_strategy_of_build() -> None:
    from typing import get_args

    from bsllmner_viewer.build.evidence import ONTOLOGY_SYNONYM, TEXT_STRATEGIES
    from bsllmner_viewer.store.metadata import EvidenceStrategy

    assert get_args(EvidenceStrategy.__value__) == (*TEXT_STRATEGIES, ONTOLOGY_SYNONYM)


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def _nfd(text: str) -> str:
    return unicodedata.normalize("NFD", text)


@pytest.mark.parametrize("convert_value", [_nfc, _nfd])
@pytest.mark.parametrize("convert_text", [_nfc, _nfd])
def test_trace_with_composed_or_decomposed_forms_matches_with_the_span_on_whole_units(
    convert_value: Callable[[str], str], convert_text: Callable[[str], str]
) -> None:
    text = convert_text("A M\u00fcller cell line")
    traced = trace(convert_value("m\u00fcller cell"), [[Text(text)]])
    assert traced is not None
    assert traced.strategy == CASE_INSENSITIVE
    (match,) = traced.matches
    assert text[match.span.start : match.span.end] == convert_text("M\u00fcller cell")


@pytest.mark.parametrize("convert", [_nfc, _nfd])
def test_trace_with_a_value_that_ends_before_a_combining_character_does_not_match(
    convert: Callable[[str], str],
) -> None:
    for strategy in TEXT_STRATEGIES:
        assert find(strategy, Text("Jose"), Text(convert("Jos\u00e9 lab"))) == []
    assert trace("Jose", [[Text(convert("Jos\u00e9 lab"))]]) is None


@pytest.mark.parametrize("convert", [_nfc, _nfd])
def test_text_words_with_a_combining_character_keep_the_unit_in_one_word(convert: Callable[[str], str]) -> None:
    text = Text(convert("M\u00fcller \u00e9clair"))
    assert [(w.folded, text.raw[w.start : w.end]) for w in text.words()] == [
        (_nfc("m\u00fcller"), convert("M\u00fcller")),
        (_nfc("\u00e9clair"), convert("\u00e9clair")),
    ]


@pytest.mark.parametrize("convert", [_nfc, _nfd])
def test_trace_with_a_short_value_counts_its_units_and_not_its_code_points(convert: Callable[[str], str]) -> None:
    value = convert("M\u00fc")
    assert trace(value, [[Text(convert("m\u00dc cell"))]]) is None
    assert trace(value, [[Text(convert("M\u00fc cell"))]]) is not None


def test_trace_with_a_camel_case_boundary_after_a_unit_does_not_depend_on_the_form() -> None:
    for convert in (_nfc, _nfd):
        traced = trace("Cre", [[Text(convert("\u00e9Cre"))]])
        assert traced is not None
        assert traced.strategy == NORMALIZED
