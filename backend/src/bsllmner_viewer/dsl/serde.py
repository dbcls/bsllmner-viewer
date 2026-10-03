"""AST to JSON tree.

BoolOp:       {"op": "AND"|"OR"|"NOT", "rules": [...]}
Leaf (value): {"field": "...", "op": "eq", "value": "..."}
Leaf (range): {"field": "...", "op": "between", "from": "...", "to": "..."}
FreeText:     {"op": "free_text", "value": "...", "is_phrase": bool}
"""

from __future__ import annotations

from typing import Any

from bsllmner_viewer.dsl.ast import FieldClause, FreeText, Node, Range
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.validator import resolve_operator


def ast_to_json(ast: Node, fields: FieldSet) -> dict[str, Any]:
    if isinstance(ast, FreeText):
        return {"op": "free_text", "value": ast.value, "is_phrase": ast.is_phrase}
    if isinstance(ast, FieldClause):
        _, op = resolve_operator(ast, fields)
        if isinstance(ast.value, Range):
            return {"field": ast.field, "op": op, "from": ast.value.from_, "to": ast.value.to}
        return {"field": ast.field, "op": op, "value": ast.value}
    return {"op": ast.op, "rules": [ast_to_json(c, fields) for c in ast.children]}
