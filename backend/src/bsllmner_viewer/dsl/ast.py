"""AST node types of the condition DSL."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

type ValueKind = Literal["phrase", "word", "wildcard", "date", "range"]
type BoolOpKind = Literal["AND", "OR", "NOT"]


@dataclass(frozen=True, slots=True)
class Position:
    """Location in the condition string: 1-based column and length."""

    column: int
    length: int


DUMMY_POSITION = Position(column=1, length=0)


@dataclass(frozen=True, slots=True)
class Range:
    """A `[from TO to]` value."""

    from_: str
    to: str


@dataclass(frozen=True, slots=True)
class FreeText:
    """A term without a field. Accepted by the grammar and rejected by validation."""

    value: str
    is_phrase: bool = False
    position: Position = DUMMY_POSITION


@dataclass(frozen=True, slots=True)
class FieldClause:
    """A `field:value` leaf."""

    field: str
    value_kind: ValueKind
    value: str | Range
    position: Position = DUMMY_POSITION


@dataclass(frozen=True, slots=True)
class BoolOp:
    """`AND`, `OR`, or `NOT` over child nodes. `NOT` has exactly one child."""

    op: BoolOpKind
    children: tuple[Node, ...]
    position: Position = DUMMY_POSITION


type Node = FreeText | FieldClause | BoolOp


def clause(field: str, value: str, *, kind: ValueKind | None = None) -> FieldClause:
    """Build a leaf for a value, choosing `word` when the value is a bare word and `phrase` otherwise."""
    from bsllmner_viewer.dsl.lex import WORD_RE, needs_quote

    if kind is None:
        kind = "word" if WORD_RE.match(value) and not needs_quote(value) else "phrase"
    return FieldClause(field=field, value_kind=kind, value=value)


def range_clause(field: str, from_: str, to: str) -> FieldClause:
    return FieldClause(field=field, value_kind="range", value=Range(from_=from_, to=to))


def and_(*children: Node) -> Node:
    flat = tuple(
        c
        for child in children
        for c in (child.children if isinstance(child, BoolOp) and child.op == "AND" else (child,))
    )
    if len(flat) == 1:
        return flat[0]
    return BoolOp(op="AND", children=flat)


def or_(*children: Node) -> Node:
    flat = tuple(
        c
        for child in children
        for c in (child.children if isinstance(child, BoolOp) and child.op == "OR" else (child,))
    )
    if len(flat) == 1:
        return flat[0]
    return BoolOp(op="OR", children=flat)


def not_(child: Node) -> BoolOp:
    return BoolOp(op="NOT", children=(child,))


def leaves(node: Node) -> list[FieldClause]:
    """Field clauses of a tree in document order."""
    if isinstance(node, FieldClause):
        return [node]
    if isinstance(node, FreeText):
        return []
    return [leaf for child in node.children for leaf in leaves(child)]


def normalize(node: Node) -> Node:
    """The shape parse produces for any serialized tree: nested same-op AND/OR flattened, word/phrase canonical."""
    if isinstance(node, FieldClause):
        return _normalize_kind(node)
    if not isinstance(node, BoolOp):
        return node
    children = tuple(normalize(c) for c in node.children)
    if node.op == "NOT":
        return BoolOp(op="NOT", children=children, position=node.position)
    flat: list[Node] = []
    for child in children:
        if isinstance(child, BoolOp) and child.op == node.op:
            flat.extend(child.children)
        else:
            flat.append(child)
    return BoolOp(op=node.op, children=tuple(flat), position=node.position)


def _normalize_kind(node: FieldClause) -> FieldClause:
    """Use `word` exactly when the value can be written bare; `phrase` otherwise."""
    from bsllmner_viewer.dsl.lex import WORD_RE, needs_quote

    if node.value_kind not in ("word", "phrase") or not isinstance(node.value, str):
        return node
    kind: ValueKind = "word" if WORD_RE.match(node.value) and not needs_quote(node.value) else "phrase"
    if kind == node.value_kind:
        return node
    return FieldClause(field=node.field, value_kind=kind, value=node.value, position=node.position)


def structurally_equal(a: Node, b: Node) -> bool:
    """Equality that ignores positions."""
    if isinstance(a, FreeText) and isinstance(b, FreeText):
        return a.value == b.value and a.is_phrase == b.is_phrase
    if isinstance(a, FieldClause) and isinstance(b, FieldClause):
        return a.field == b.field and a.value_kind == b.value_kind and a.value == b.value
    if isinstance(a, BoolOp) and isinstance(b, BoolOp):
        return (
            a.op == b.op
            and len(a.children) == len(b.children)
            and all(structurally_equal(x, y) for x, y in zip(a.children, b.children, strict=True))
        )
    return False
