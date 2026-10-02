from __future__ import annotations

import pytest

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Range
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.parser import parse


def _leaf(node: object) -> FieldClause:
    assert isinstance(node, FieldClause)
    return node


def test_parse_field_word_gives_word_clause() -> None:
    node = _leaf(parse("library_strategy:ATAC-seq"))
    assert (node.field, node.value_kind, node.value) == ("library_strategy", "word", "ATAC-seq")


def test_parse_field_phrase_unescapes_quotes_and_backslashes() -> None:
    node = _leaf(parse(r'title:"a \"quoted\" \\ value"'))
    assert node.value_kind == "phrase"
    assert node.value == 'a "quoted" \\ value'


def test_parse_single_quoted_phrase_is_a_phrase() -> None:
    node = _leaf(parse("disease:'MONDO:0007254'"))
    assert (node.value_kind, node.value) == ("phrase", "MONDO:0007254")


def test_parse_range_gives_range_value() -> None:
    node = _leaf(parse("date_published:[2015-01-01 TO 2020-12-31]"))
    assert node.value_kind == "range"
    assert node.value == Range(from_="2015-01-01", to="2020-12-31")


def test_parse_date_gives_date_kind() -> None:
    assert _leaf(parse("date_published:2020-01-01")).value_kind == "date"


def test_parse_and_binds_tighter_than_or() -> None:
    node = parse("disease:a OR disease:b AND tissue:c")
    assert isinstance(node, BoolOp)
    assert node.op == "OR"
    assert isinstance(node.children[1], BoolOp)
    assert node.children[1].op == "AND"


def test_parse_parentheses_group_or_inside_and() -> None:
    node = parse('(disease:"MONDO:0007254" OR disease:"MONDO:0005061") AND library_strategy:ATAC-seq')
    assert isinstance(node, BoolOp)
    assert node.op == "AND"
    assert isinstance(node.children[0], BoolOp)
    assert node.children[0].op == "OR"
    assert [c.value for c in node.children[0].children if isinstance(c, FieldClause)] == [
        "MONDO:0007254",
        "MONDO:0005061",
    ]


def test_parse_not_applies_to_atom() -> None:
    node = parse("NOT disease_status:mapped AND tissue:x")
    assert isinstance(node, BoolOp)
    assert node.op == "AND"
    assert isinstance(node.children[0], BoolOp)
    assert node.children[0].op == "NOT"


def test_parse_positions_are_one_based_columns() -> None:
    node = parse("disease:a AND tissue:b")
    assert isinstance(node, BoolOp)
    first, second = node.children
    assert _leaf(first).position.column == 1
    assert _leaf(second).position.column == 15


def test_parse_free_text_is_a_free_text_node() -> None:
    node = parse("cancer tumor")
    assert isinstance(node, FreeText)
    assert node.value == "cancer tumor"
    assert node.is_phrase is False


def test_parse_wildcard_is_a_wildcard_clause() -> None:
    assert _leaf(parse("title:HIF-1*")).value_kind == "wildcard"


@pytest.mark.parametrize("dsl", ["", "   ", "disease:", "(disease:a", "disease:a OR", "disease:a ^2", "title:/re/"])
def test_parse_syntax_error_raises_unexpected_token(dsl: str) -> None:
    with pytest.raises(DslError) as info:
        parse(dsl)
    assert info.value.type is ErrorType.unexpected_token


def test_parse_lower_case_operators_are_not_operators() -> None:
    with pytest.raises(DslError) as info:
        parse("disease:a and tissue:b")
    assert info.value.type is ErrorType.unexpected_token


def test_parse_over_length_is_rejected() -> None:
    with pytest.raises(DslError) as info:
        parse("title:" + "a" * 5000)
    assert info.value.type is ErrorType.unexpected_token
    assert "too long" in info.value.detail
