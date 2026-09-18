from __future__ import annotations

from hypothesis import given, settings

from bsllmner_viewer.dsl.ast import Node, normalize, structurally_equal
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serde import ast_to_json, json_to_ast
from bsllmner_viewer.dsl.serializer import serialize
from bsllmner_viewer.dsl.validator import validate
from tests.strategies import FIELDS, asts


@settings(max_examples=300)
@given(asts)
def test_parse_of_serialize_is_structurally_equal(ast: Node) -> None:
    validate(ast, FIELDS)
    dsl = serialize(ast)
    reparsed = parse(dsl)
    assert structurally_equal(normalize(reparsed), normalize(ast)), dsl


@settings(max_examples=200)
@given(asts)
def test_serialize_is_idempotent_over_parse(ast: Node) -> None:
    dsl = serialize(ast)
    assert serialize(parse(dsl)) == dsl


@settings(max_examples=200)
@given(asts)
def test_json_round_trip_is_structurally_equal(ast: Node) -> None:
    validate(ast, FIELDS)
    assert structurally_equal(normalize(json_to_ast(ast_to_json(ast, FIELDS), FIELDS)), normalize(ast))
