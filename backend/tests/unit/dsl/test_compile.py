from __future__ import annotations

import pytest

from bsllmner_viewer.dsl.ast import FreeText
from bsllmner_viewer.dsl.compile import compile_condition
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.parser import parse

FIELDS = FieldSet(("disease",))


def test_compile_none_is_true() -> None:
    assert compile_condition(None, FIELDS).sql == "TRUE"


def test_compile_term_uses_closure_semi_join() -> None:
    pred = compile_condition(parse('disease:"MONDO:1"'), FIELDS)
    assert "annotation_closure" in pred.sql
    assert pred.params == ["disease", "MONDO:1"]


def test_compile_status_group_expands_to_statuses() -> None:
    pred = compile_condition(parse("disease_status:unmapped"), FIELDS)
    assert pred.params == ["disease", "unmapped_no_candidate", "unmapped_rejected"]


def test_compile_boolean_structure_and_parameter_order() -> None:
    pred = compile_condition(parse("NOT organism_id:9606 AND (library_strategy:a OR disease:b)"), FIELDS)
    term = "pn.biosample IN (SELECT biosample FROM annotation_closure WHERE field = ? AND ancestor = ?)"
    assert pred.sql == f"(NOT (pn.organism_id = ?) AND (pn.library_strategy = ? OR {term}))"
    assert pred.params == [9606, "a", "disease", "b"]


def test_compile_date_range_and_bioproject() -> None:
    pred = compile_condition(parse("date_published:[2015-01-01 TO 2020-12-31] AND bioproject:PRJNA1"), FIELDS)
    assert pred.params == ["2015-01-01", "2020-12-31", "PRJNA1"]


_TEXT = "pn.biosample IN (SELECT biosample FROM searchable_text WHERE {})"


def test_compile_keyword_matches_the_searchable_text_with_like_patterns() -> None:
    pred = compile_condition(parse("hypoxia"), FIELDS)
    assert pred.sql == "(" + _TEXT.format("(text LIKE ?)") + ")"
    assert pred.params == ["% hypoxia%"]


def test_compile_keyword_requires_every_word() -> None:
    pred = compile_condition(parse("breast cancer"), FIELDS)
    assert pred.sql == "(" + _TEXT.format("(text LIKE ?) AND (text LIKE ?)") + ")"
    assert pred.params == ["% breast %", "% cancer%"]


def test_compile_keyword_word_with_symbols_accepts_either_form() -> None:
    pred = compile_condition(parse("IL-4"), FIELDS)
    assert pred.sql == "(" + _TEXT.format("(text LIKE ? OR text LIKE ?)") + ")"
    assert pred.params == ["% il 4 %", "% il4 %"]


def test_compile_keyword_phrase_is_one_pattern() -> None:
    pred = compile_condition(parse('"breast cancer"'), FIELDS)
    assert pred.params == ["% breast cancer %"]


@pytest.mark.parametrize(
    ("word", "sql"),
    [
        ("SAMN1", "pn.biosample = ?"),
        ("srx1", "pn.experiment = ?"),
        ("err1", "pn.experiment IN (SELECT experiment FROM sra_run WHERE accession = ?)"),
        ("PRJNA1", "pn.biosample IN (SELECT biosample FROM biosample_bioproject WHERE bioproject = ?)"),
    ],
)
def test_compile_keyword_accession_word_is_compared_with_the_accession_in_upper_case(word: str, sql: str) -> None:
    pred = compile_condition(parse(word), FIELDS)
    assert pred.sql == f"({sql})"
    assert pred.params == [word.upper()]


def test_compile_keyword_accession_and_text_words_are_both_required() -> None:
    pred = compile_condition(parse("liver SAMN1"), FIELDS)
    assert pred.sql == "(pn.biosample = ? AND " + _TEXT.format("(text LIKE ?)") + ")"
    assert pred.params == ["SAMN1", "% liver %"]


def test_compile_keyword_under_not_and_or_keeps_the_parameter_order() -> None:
    pred = compile_condition(parse("NOT ab OR organism_id:9606 AND bc"), FIELDS)
    assert pred.sql.count("?") == len(pred.params)
    assert pred.params == ["% ab%", 9606, "% bc%"]
    assert pred.sql.startswith("(NOT (")


def test_compile_keyword_without_a_letter_or_a_digit_raises_invalid_value() -> None:
    for node in (FreeText("--"), FreeText("", is_phrase=True)):
        with pytest.raises(DslError) as info:
            compile_condition(node, FIELDS)
        assert info.value.type is ErrorType.invalid_value
