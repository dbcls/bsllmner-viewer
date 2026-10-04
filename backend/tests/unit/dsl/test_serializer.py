from __future__ import annotations

from bsllmner_viewer.dsl.ast import (
    FieldClause,
    FreeText,
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
        serialize(range_clause("date_published", "2015-01-01", "2020-12-31"))
        == "date_published:[2015-01-01 TO 2020-12-31]"
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


def test_serialize_then_parse_round_trips_conditions_with_groups_ranges_and_not() -> None:
    examples = [
        'disease:"MONDO:0007254" AND library_strategy:ATAC-seq AND organism_id:9606',
        '(cell_line:"CVCL:0027" OR cell_line:"CVCL:0030") AND drug:"CHEBI:28748"',
        'disease_status:unmapped AND tissue:"UBERON:0002107"',
        "date_published:[2015-01-01 TO 2020-12-31] AND (title:cancer OR title:tumor)",
        'NOT (disease:"MONDO:1" OR disease:"MONDO:2") AND identifier:SAMN00000001',
    ]
    for dsl in examples:
        ast = parse(dsl)
        assert serialize(ast) == dsl
        assert structurally_equal(parse(serialize(ast)), ast)


def test_serialize_quotes_a_value_that_starts_with_a_single_quote_and_keyword_words_that_close_one() -> None:
    node = clause("tissue", "'x")
    assert node.value_kind == "phrase"
    assert serialize(node) == 'tissue:"\'x"'
    assert structurally_equal(parse(serialize(node)), node)
    assert serialize(FreeText("x 's")) == "x 's"
    assert serialize(FreeText("'x y")) == "'x y"
    assert serialize(FreeText("'s y'")) == "\"'s y'\""
    assert serialize(FreeText("a' b", is_phrase=True)) == '"a\\\' b"'


def test_serialize_single_quote_inside_or_at_the_end_of_a_word_stays_bare() -> None:
    assert serialize(FreeText("5'-UTR 3' Alzheimer's")) == "5'-UTR 3' Alzheimer's"
    assert serialize(clause("tissue", "b'")) == "tissue:b'"


def test_serialize_then_parse_round_trips_clauses_that_together_hold_a_pair_of_single_quotes() -> None:
    ast = and_(clause("tissue", "'a"), clause("disease", "b'"), FreeText("'s", is_phrase=True), FreeText("Crohn's"))
    assert serialize(ast) == "tissue:\"'a\" AND disease:b' AND \"'s\" AND Crohn's"
    assert structurally_equal(parse(serialize(ast)), ast)
