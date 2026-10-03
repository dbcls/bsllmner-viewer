"""AST to condition string. `parse(serialize(ast))` is structurally equal to `ast`."""

from __future__ import annotations

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Node, Range, ValueKind
from bsllmner_viewer.dsl.lex import is_bare_word

_AND = 3
_OR = 2
_TOP = 0


def serialize(node: Node) -> str:
    return _node(node, _TOP)


def _node(node: Node, parent_prec: int) -> str:
    if isinstance(node, FreeText):
        return _free_text(node)
    if isinstance(node, FieldClause):
        return f"{node.field}:{_value(node.value_kind, node.value)}"
    if node.op == "NOT":
        if len(node.children) != 1:
            raise ValueError(f"NOT must have exactly one child, got {len(node.children)}")
        child = node.children[0]
        inner = _node(child, _TOP)
        return f"NOT ({inner})" if isinstance(child, BoolOp) else f"NOT {inner}"
    own = _AND if node.op == "AND" else _OR
    rendered = f" {node.op} ".join(_node(child, own) for child in node.children)
    return f"({rendered})" if own < parent_prec else rendered


def _value(kind: ValueKind, value: str | Range) -> str:
    if kind == "range":
        if not isinstance(value, Range):
            raise TypeError("range value_kind requires Range")
        return f"[{value.from_} TO {value.to}]"
    if not isinstance(value, str):
        raise TypeError("non-range value_kind requires str")
    if kind == "phrase" or (kind == "word" and not is_bare_word(value)):
        return quote(value)
    return value


def _free_text(node: FreeText) -> str:
    if node.is_phrase:
        return quote(node.value)
    tokens = node.value.split(" ")
    if " ".join(node.value.split()) == node.value and all(is_bare_word(t) for t in tokens):
        return node.value
    return quote(node.value)


def quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'
