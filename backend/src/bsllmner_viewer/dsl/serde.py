"""AST <-> JSON tree.

BoolOp:       {"op": "AND"|"OR"|"NOT", "rules": [...]}
Leaf (value): {"field": "...", "op": "eq"|"contains", "value": "..."}
Leaf (range): {"field": "...", "op": "between", "from": "...", "to": "..."}
FreeText:     {"op": "free_text", "value": "...", "is_phrase": bool}
"""

from __future__ import annotations

from typing import Any

from bsllmner_viewer.dsl.ast import BoolOp, BoolOpKind, FieldClause, FreeText, Node, Range, ValueKind
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.lex import WORD_RE, needs_quote
from bsllmner_viewer.dsl.validator import resolve_operator

_BOOL_OPS = frozenset({"AND", "OR", "NOT"})
_LEAF_OPS = frozenset({"eq", "contains", "between"})


def ast_to_json(ast: Node, fields: FieldSet) -> dict[str, Any]:
    if isinstance(ast, FreeText):
        return {"op": "free_text", "value": ast.value, "is_phrase": ast.is_phrase}
    if isinstance(ast, FieldClause):
        _, op = resolve_operator(ast, fields)
        if isinstance(ast.value, Range):
            return {"field": ast.field, "op": op, "from": ast.value.from_, "to": ast.value.to}
        return {"field": ast.field, "op": op, "value": ast.value}
    return {"op": ast.op, "rules": [ast_to_json(c, fields) for c in ast.children]}


def json_to_ast(payload: Any, fields: FieldSet) -> Node:
    """Convert a JSON tree to an AST. Raises DslError(invalid_ast) when the shape is wrong."""
    if not isinstance(payload, dict):
        raise DslError(type=ErrorType.invalid_ast, detail="AST node must be an object")
    op = payload.get("op")
    if op == "free_text":
        return FreeText(value=_str(payload, "value"), is_phrase=bool(payload.get("is_phrase", False)))
    if op in _BOOL_OPS:
        rules = payload.get("rules")
        if not isinstance(rules, list) or not rules:
            raise DslError(type=ErrorType.invalid_ast, detail=f"{op} node requires a non-empty 'rules' list")
        if op == "NOT" and len(rules) != 1:
            raise DslError(type=ErrorType.invalid_ast, detail="NOT node requires exactly one rule")
        children = tuple(json_to_ast(r, fields) for r in rules)
        return BoolOp(op=_bool_op(op), children=children)
    if op not in _LEAF_OPS:
        raise DslError(type=ErrorType.invalid_ast, detail=f"unknown op {op!r}")
    field = _str(payload, "field")
    if op == "between":
        return FieldClause(
            field=field, value_kind="range", value=Range(from_=_str(payload, "from"), to=_str(payload, "to"))
        )
    value = _str(payload, "value")
    return FieldClause(field=field, value_kind=_infer_kind(field, op, value, fields), value=value)


def _bool_op(op: str) -> BoolOpKind:
    if op == "AND":
        return "AND"
    if op == "OR":
        return "OR"
    return "NOT"


def _str(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise DslError(type=ErrorType.invalid_ast, detail=f"'{key}' must be a string")
    return value


def _infer_kind(field: str, op: str, value: str, fields: FieldSet) -> ValueKind:
    field_def = fields.get(field)
    if field_def is not None and field_def.kind == "date" and op == "eq":
        return "date"
    if WORD_RE.match(value) and not needs_quote(value):
        return "word"
    return "phrase"
