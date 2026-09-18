from __future__ import annotations

from bsllmner_viewer.dsl.ast import (
    FieldClause,
    FreeText,
    Range,
    and_,
    clause,
    not_,
    or_,
    range_clause,
    structurally_equal,
)
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serializer import serialize


def test_serialize_phrase_quotes_and_escapes() -> None:
    assert serialize(FieldClause("title", "phrase", 'a "b" \\')) == r'title:"a \"b\" \\"'


def test_serialize_word_with_colon_is_quoted() -> None:
    assert serialize(clause("disease", "MONDO:0007254")) == 'disease:"MONDO:0007254"'


def test_serialize_word_that_looks_like_a_date_is_quoted() -> None:
    assert serialize(FieldClause("title", "word", "2020-01-01")) == 'title:"2020-01-01"'


def test_serialize_word_that_is_an_operator_literal_is_quoted() -> None:
    assert serialize(FieldClause("title", "word", "AND")) == 'title:"AND"'


def test_serialize_range() -> None:
    assert (
        serialize(range_clause("date_created", "2015-01-01", "2020-12-31")) == "date_created:[2015-01-01 TO 2020-12-31]"
    )


def test_serialize_or_inside_and_is_parenthesized() -> None:
    ast = and_(or_(clause("disease", "MONDO:1"), clause("disease", "MONDO:2")), clause("library_strategy", "ATAC-seq"))
    assert serialize(ast) == '(disease:"MONDO:1" OR disease:"MONDO:2") AND library_strategy:ATAC-seq'


def test_serialize_and_inside_or_needs_no_parentheses() -> None:
    ast = or_(and_(clause("title", "a"), clause("title", "b")), clause("title", "c"))
    assert serialize(ast) == "title:a AND title:b OR title:c"


def test_serialize_not_of_bool_op_is_parenthesized() -> None:
    ast = not_(or_(clause("title", "a"), clause("title", "b")))
    assert serialize(ast) == "NOT (title:a OR title:b)"


def test_serialize_not_of_clause_is_bare() -> None:
    assert serialize(and_(clause("title", "a"), not_(clause("title", "b")))) == "title:a AND NOT title:b"


def test_serialize_free_text_keeps_bare_words_and_quotes_phrases() -> None:
    assert serialize(FreeText("cancer tumor")) == "cancer tumor"
    assert serialize(FreeText("cancer", is_phrase=True)) == '"cancer"'
    assert serialize(FreeText("a:b")) == '"a:b"'


def test_serialize_then_parse_round_trips_spec_examples() -> None:
    examples = [
        'disease:"MONDO:0007254" AND library_strategy:ATAC-seq AND organism_id:9606',
        '(cell_line:"CVCL:0027" OR cell_line:"CVCL:0030") AND drug:"CHEBI:28748"',
        'disease_status:unmapped AND tissue:"UBERON:0002107"',
        "date_created:[2015-01-01 TO 2020-12-31] AND (title:cancer OR title:tumor)",
        'NOT (disease:"MONDO:1" OR disease:"MONDO:2") AND identifier:SAMN00000001',
    ]
    for dsl in examples:
        ast = parse(dsl)
        assert serialize(ast) == dsl
        assert structurally_equal(parse(serialize(ast)), ast)


def test_range_value_type_is_kept() -> None:
    ast = parse("date_created:[2020-01-01 TO 2020-12-31]")
    assert isinstance(ast, FieldClause)
    assert isinstance(ast.value, Range)
