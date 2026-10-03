from __future__ import annotations

import pytest

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Node, Range, not_
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.validator import validate


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


@pytest.mark.parametrize("depth", [100, 300, 2000])
def test_parse_of_redundant_parentheses_returns_the_inner_clause(depth: int) -> None:
    node = _leaf(parse("(" * depth + "disease:a" + ")" * depth))
    assert node.value == "a"


@pytest.mark.parametrize("depth", [100, 300, 500])
def test_parse_rejects_deeply_nested_groups_with_a_dsl_error(depth: int) -> None:
    with pytest.raises(DslError) as info:
        parse("(a AND " * depth + "b" + ")" * depth)
    assert info.value.type is ErrorType.nest_depth_exceeded


@pytest.mark.parametrize("depth", [100, 300, 680])
def test_parse_rejects_deeply_nested_negations_with_a_dsl_error(depth: int) -> None:
    with pytest.raises(DslError) as info:
        parse("NOT (" * depth + "disease:a" + ")" * depth)
    assert info.value.type is ErrorType.nest_depth_exceeded


def test_deep_asts_are_checked_for_depth_before_any_step_that_recurses() -> None:
    node: Node = FieldClause("disease", "word", "a")
    for _ in range(5000):
        node = not_(node)
    with pytest.raises(DslError) as info:
        validate(node, FieldSet(("disease",)))
    assert info.value.type is ErrorType.nest_depth_exceeded


@pytest.mark.parametrize("depth", [6, 64, 65, 500])
def test_parse_reports_one_depth_limit_for_every_depth_over_it(depth: int) -> None:
    with pytest.raises(DslError) as info:
        parse("a OR (" * depth + "b" + ")" * depth)
    assert info.value.type is ErrorType.nest_depth_exceeded
    assert "exceeds limit 5 " in info.value.detail


@pytest.mark.parametrize("dsl", ["NOT'x'", "a OR'x'", "a AND'x'", "NOT'x y'"])
def test_parse_reads_an_operator_before_a_single_quote(dsl: str) -> None:
    ast = parse(dsl)
    assert isinstance(ast, BoolOp)


@pytest.mark.parametrize("word", ["ORAL'", "NOTE's", "ANDx'y'"])
def test_parse_reads_a_word_with_a_single_quote_after_letters_as_a_word(word: str) -> None:
    assert isinstance(parse(f"x {word}"), FreeText)


@pytest.mark.parametrize("word", ["NOTCH1", "ORGANOID", "ANDROGEN", "ORF1ab", "NOT-x", "AND.1"])
def test_parse_reads_a_word_that_starts_with_an_operator_as_a_word(word: str) -> None:
    assert parse(f"{word} signaling") == FreeText(f"{word} signaling", position=parse(f"{word} signaling").position)
    ast = parse(f"x AND {word} AND y")
    assert isinstance(ast, BoolOp)
    assert [type(c) for c in ast.children] == [FreeText, FreeText, FreeText]
    assert ast.children[1].value == word  # type: ignore[union-attr]


@pytest.mark.parametrize(
    ("dsl", "op"),
    [("NOT(a)", "NOT"), ("(a)OR(b)", "OR"), ('NOT "x"', "NOT"), ("(a)AND(b)", "AND"), ("a OR\tb", "OR")],
)
def test_parse_reads_an_operator_before_a_parenthesis_a_quote_or_a_space(dsl: str, op: str) -> None:
    ast = parse(dsl)
    assert isinstance(ast, BoolOp)
    assert ast.op == op
