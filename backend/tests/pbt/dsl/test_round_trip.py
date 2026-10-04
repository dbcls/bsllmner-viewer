from __future__ import annotations

from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import TypeAdapter

from bsllmner_viewer.api.schemas import AstNode
from bsllmner_viewer.dsl.ast import BoolOp, FreeText, Node, Range, normalize, structurally_equal
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serde import ast_to_json
from bsllmner_viewer.dsl.serializer import serialize
from bsllmner_viewer.dsl.validator import validate
from tests.strategies import FIELDS, asts

_API_AST = TypeAdapter[AstNode](AstNode)


@settings(max_examples=300)
@given(asts)
def test_parse_of_serialize_is_structurally_equal(ast: Node) -> None:
    validate(ast, FIELDS)
    dsl = serialize(normalize(ast))
    reparsed = parse(dsl)
    assert structurally_equal(normalize(reparsed), normalize(ast)), dsl


@settings(max_examples=200)
@given(asts)
def test_serialize_is_idempotent_over_parse(ast: Node) -> None:
    dsl = serialize(normalize(ast))
    assert serialize(parse(dsl)) == dsl


@settings(max_examples=200)
@given(asts)
def test_ast_to_json_output_validates_as_an_api_ast_and_keeps_every_node_and_value(ast: Node) -> None:
    validate(ast, FIELDS)
    tree = ast_to_json(ast, FIELDS)
    model = _API_AST.validate_python(tree)
    assert _API_AST.dump_python(model, by_alias=True) == tree
    _assert_same_nodes(ast, tree)


def _assert_same_nodes(node: Node, tree: dict[str, Any]) -> None:
    if isinstance(node, BoolOp):
        assert tree["op"] == node.op
        assert len(tree["rules"]) == len(node.children)
        for child, child_tree in zip(node.children, tree["rules"], strict=True):
            _assert_same_nodes(child, child_tree)
    elif isinstance(node, FreeText):
        assert tree == {"op": "free_text", "value": node.value, "is_phrase": node.is_phrase}
    elif isinstance(node.value, Range):
        assert tree["field"] == node.field
        assert (tree["from"], tree["to"]) == (node.value.from_, node.value.to)
    else:
        assert tree["field"] == node.field
        assert tree["value"] == node.value


@settings(max_examples=200)
@given(st.lists(st.sampled_from(["NOTCH1", "ORGANOID", "ANDROGEN", "ORF1ab", "NOT", "AND", "OR", "x"]), min_size=1))
def test_keywords_with_operator_words_and_words_that_start_with_an_operator_round_trip(ws: list[str]) -> None:
    ast = normalize(FreeText(" ".join(ws)))
    assert structurally_equal(normalize(parse(serialize(ast))), ast)


@pytest.mark.parametrize(
    "dsl",
    [
        "2024-01-01x cancer",
        "1999-01-01_rep1 liver",
        "liver 2024-01-01x",
        "\uff12\uff10\uff12\uff14-\uff10\uff11-\uff10\uff11 cancer",
        "cancer AND 'x'",
        "cancer 's",
        "x 's y's",
        "a OR'x'",
    ],
)
def test_keywords_that_start_like_a_date_or_a_quote_keep_their_meaning_through_q(dsl: str) -> None:
    ast = normalize(parse(dsl))
    assert structurally_equal(normalize(parse(serialize(ast))), ast)
