from __future__ import annotations

import duckdb
import pytest

from bsllmner_viewer.dsl.ast import FreeText, Node, not_
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
    assert (
        pred.sql
        == f"(NOT (COALESCE(pn.organism_id = ?, FALSE)) AND (COALESCE(pn.library_strategy = ?, FALSE) OR {term}))"
    )
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


@pytest.mark.parametrize(
    "dsl",
    [
        "organism_id:9606",
        "library_strategy:RNA-Seq",
        "date_published:2020-01-01",
        "date_published:[2020-01-01 TO 2021-12-31]",
    ],
)
def test_compile_clause_on_a_column_that_can_be_null_and_its_negation_cover_the_population(dsl: str) -> None:
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE population "
        "(biosample VARCHAR, organism_id INTEGER, library_strategy VARCHAR, date_published DATE)"
    )
    con.execute(
        "INSERT INTO population VALUES ('a', 9606, 'RNA-Seq', '2020-01-01'), ('b', 10090, 'ATAC-seq', '2022-05-05'), "
        "('c', NULL, NULL, NULL)"
    )

    def total(ast: Node) -> int:
        pred = compile_condition(ast, FIELDS)
        row = con.execute(f"SELECT count(*) FROM population pn WHERE {pred.sql}", pred.params).fetchone()
        assert row is not None
        return int(row[0])

    ast = parse(dsl)
    assert total(ast) + total(not_(ast)) == 3
    assert total(ast) == 1
