from __future__ import annotations

from hypothesis import given, settings
from pydantic import TypeAdapter

from bsllmner_viewer.api.schemas import AstNode
from bsllmner_viewer.dsl.ast import Node, normalize, structurally_equal
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
def test_ast_to_json_output_validates_as_an_api_ast_and_keeps_its_keys(ast: Node) -> None:
    validate(ast, FIELDS)
    tree = ast_to_json(ast, FIELDS)
    model = _API_AST.validate_python(tree)
    assert _API_AST.dump_python(model, by_alias=True) == tree
