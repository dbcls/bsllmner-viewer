from __future__ import annotations

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Node, normalize, structurally_equal
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.lex import is_bare_word
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serializer import quote, serialize
from tests.strategies import apostrophe_words, words

_values = st.text(st.characters(blacklist_categories=["Cs"], max_codepoint=0x24F), min_size=1, max_size=10)


@given(_values)
def test_a_bare_word_parses_as_the_same_word_and_any_other_value_parses_as_the_same_phrase_when_quoted(
    value: str,
) -> None:
    text = value if is_bare_word(value) else quote(value)
    node = parse(f"title:{text}")
    assert isinstance(node, FieldClause)
    assert node.value == value
    assert (node.value_kind == "word") == is_bare_word(value)


@pytest.mark.parametrize(
    "value",
    ["2024-01-01x", "2024-01-01-extra", "1234-56-78abc", "\uff12\uff10\uff12\uff14-\uff10\uff11-\uff10\uff11"],
)
def test_a_value_that_starts_like_a_date_is_quoted_and_read_back_as_the_same_value(value: str) -> None:
    assert not is_bare_word(value)
    node = parse(serialize(FieldClause("disease", "word", value)))
    assert isinstance(node, FieldClause)
    assert node.value == value


_ANY_VALUE = st.text(st.characters(blacklist_categories=["Cs"]), max_size=12)


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


@given(_ANY_VALUE)
def test_a_single_quoted_phrase_with_escapes_parses_as_the_same_value(value: str) -> None:
    node = parse(f"title:'{_escape(value)}'")
    assert isinstance(node, FieldClause)
    assert (node.value_kind, node.value) == ("phrase", value)


@given(_ANY_VALUE)
def test_a_double_quoted_phrase_with_escaped_single_quotes_parses_as_the_same_value(value: str) -> None:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("'", "\\'")
    node = parse(f'title:"{escaped}"')
    assert isinstance(node, FieldClause)
    assert (node.value_kind, node.value) == ("phrase", value)


_OPERATORS = ["AND", "OR", "NOT"]
_DELIMITERS = [*")[]{}:^~*?/(\"'", " ", "\t", ""]


def _free_texts(node: Node) -> list[FreeText]:
    if isinstance(node, FreeText):
        return [node]
    if isinstance(node, BoolOp):
        return [t for child in node.children for t in _free_texts(child)]
    return []


def _parse_or_none(dsl: str) -> Node | None:
    """The AST, or None when the condition is a syntax error."""
    try:
        return parse(dsl)
    except DslError as error:
        if error.type is not ErrorType.unexpected_token:
            raise
        return None


@pytest.mark.parametrize("op", _OPERATORS)
@pytest.mark.parametrize("delimiter", _DELIMITERS)
def test_an_operator_followed_by_a_delimiter_is_an_operator_or_a_syntax_error(op: str, delimiter: str) -> None:
    # `NOT` starts an operand, so it is an operator after `AND`. `AND` and `OR` follow an operand.
    head = "x AND " if op == "NOT" else "x "
    templates = [f"({head}{op}{delimiter})"] + ([f"{head}{op}{delimiter}y"] if delimiter else [])
    for dsl in templates:
        node = _parse_or_none(dsl)
        if node is None:
            continue
        assert all(op not in text.value.split() for text in _free_texts(node)), dsl


_WORD_CHARACTERS = st.one_of(
    st.sampled_from(list("abcXYZ0189-._")),
    st.characters(min_codepoint=0x80, max_codepoint=0x24F, categories=["L"]),
)


@pytest.mark.parametrize("op", _OPERATORS)
@given(char=_WORD_CHARACTERS)
def test_an_operator_followed_by_a_word_character_is_part_of_a_word(op: str, char: str) -> None:
    node = parse(f"x {op}{char}y")
    assert node == FreeText(f"x {op}{char}y", position=node.position)


_inner_apostrophe_words = st.builds(
    lambda word, at: word[: at % len(word) + 1] + "'" + word[at % len(word) + 1 :], words, st.integers(0, 20)
)


@given(words, _inner_apostrophe_words)
def test_a_word_with_a_single_quote_inside_or_at_its_end_stays_part_of_a_keyword(first: str, second: str) -> None:
    node = parse(f"{first} {second}")
    assert isinstance(node, FreeText)
    assert node.value == f"{first} {second}"
    assert not node.is_phrase


@given(words, words)
def test_a_closed_single_quoted_phrase_after_a_word_is_an_unexpected_token(first: str, second: str) -> None:
    with pytest.raises(DslError) as info:
        parse(f"{first} '{second}'")
    assert info.value.type is ErrorType.unexpected_token


@given(words, words)
def test_a_word_that_starts_with_a_single_quote_that_no_quote_closes_stays_part_of_a_keyword(
    first: str, second: str
) -> None:
    node = parse(f"{first} '{second}")
    assert isinstance(node, FreeText)
    assert (node.value, node.is_phrase) == (f"{first} '{second}", False)


_SQ_TOKENS = st.one_of(
    words,
    apostrophe_words,
    st.builds(lambda w: f"'{w}'", words),
    st.builds(lambda a, b: f"'{a} {b}'", words, apostrophe_words),
    st.builds(lambda p: quote(p), st.text(st.sampled_from("ab '\\\")"), min_size=1, max_size=6)),
    st.sampled_from(["AND", "OR", "NOT"]),
)


@settings(max_examples=500)
@given(st.lists(_SQ_TOKENS, min_size=1, max_size=6))
def test_parse_of_serialize_of_a_condition_with_single_quotes_is_the_condition(tokens: list[str]) -> None:
    try:
        parsed = parse(" ".join(tokens))
    except DslError:
        parsed = None
    assume(parsed is not None)
    assert parsed is not None
    ast = normalize(parsed)
    assert structurally_equal(normalize(parse(serialize(ast))), ast)
