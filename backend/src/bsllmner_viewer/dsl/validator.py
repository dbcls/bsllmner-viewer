"""AST validation against a field set."""

from __future__ import annotations

import datetime
import re

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Node, Range
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldDef, FieldSet, Operator, expand_status

MAX_DEPTH = 5
MAX_NODES = 512

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DIGITS_RE = re.compile(r"^\d+$")


def validate(ast: Node, fields: FieldSet, *, max_depth: int = MAX_DEPTH, max_nodes: int = MAX_NODES) -> None:
    """Raise DslError when the AST uses unknown fields, unsupported operators, or invalid values."""
    total = _count(ast)
    if total > max_nodes:
        raise DslError(type=ErrorType.nest_depth_exceeded, detail=f"total node count {total} exceeds limit {max_nodes}")
    _check_depth(ast, 1, max_depth)
    _check_nodes(ast, fields)


def resolve_operator(clause: FieldClause, fields: FieldSet) -> tuple[FieldDef, Operator]:
    """The field definition and operator of a clause, or DslError when the clause is not valid for the field."""
    field = fields.get(clause.field)
    if field is None:
        raise DslError(
            type=ErrorType.unknown_field,
            detail=f"unknown field {clause.field!r} at column {clause.position.column}",
            column=clause.position.column,
            length=clause.position.length,
        )
    op = _operator_for(field, clause)
    if op is None:
        raise DslError(
            type=ErrorType.invalid_operator_for_field,
            detail=(
                f"value kind {clause.value_kind!r} is not accepted for field {clause.field!r} "
                f"at column {clause.position.column}"
            ),
            column=clause.position.column,
            length=clause.position.length,
        )
    return field, op


def _operator_for(field: FieldDef, clause: FieldClause) -> Operator | None:
    kind = clause.value_kind
    if field.kind == "date":
        if kind == "date":
            return "eq"
        if kind == "range":
            return "between"
        return None
    if kind not in ("word", "phrase"):
        return None
    return "contains" if field.kind in ("value", "title") else "eq"


def _count(node: Node) -> int:
    if isinstance(node, FieldClause | FreeText):
        return 1
    return 1 + sum(_count(c) for c in node.children)


def _check_depth(node: Node, current: int, max_depth: int) -> None:
    if isinstance(node, FieldClause | FreeText):
        return
    if current > max_depth:
        raise DslError(
            type=ErrorType.nest_depth_exceeded,
            detail=f"nest depth {current} exceeds limit {max_depth} at column {node.position.column}",
            column=node.position.column,
            length=node.position.length,
        )
    for child in node.children:
        _check_depth(child, current + 1, max_depth)


def _check_nodes(node: Node, fields: FieldSet) -> None:
    if isinstance(node, FreeText):
        raise DslError(
            type=ErrorType.free_text_not_supported,
            detail=f"free text is not supported; use field:value at column {node.position.column}",
            column=node.position.column,
            length=node.position.length,
        )
    if isinstance(node, BoolOp):
        for child in node.children:
            _check_nodes(child, fields)
        return
    field, _ = resolve_operator(node, fields)
    _check_value(field, node)


def _check_value(field: FieldDef, clause: FieldClause) -> None:
    col, length = clause.position.column, clause.position.length
    if isinstance(clause.value, Range):
        for bound in (clause.value.from_, clause.value.to):
            _check_date(bound, col, length)
        if clause.value.from_ > clause.value.to:
            raise DslError(
                type=ErrorType.invalid_value,
                detail=f"range start is after range end at column {col}",
                column=col,
                length=length,
            )
        return
    value = clause.value
    if not value:
        raise DslError(type=ErrorType.missing_value, detail=f"empty value at column {col}", column=col, length=length)
    if field.kind == "date":
        _check_date(value, col, length)
    elif field.kind == "status" and not expand_status(value):
        raise DslError(
            type=ErrorType.invalid_value,
            detail=f"unknown status {value!r} for field {field.name!r} at column {col}",
            column=col,
            length=length,
        )
    elif field.kind == "organism" and not _DIGITS_RE.match(value):
        raise DslError(
            type=ErrorType.invalid_value,
            detail=f"organism_id must be an NCBI Taxonomy ID at column {col}",
            column=col,
            length=length,
        )


def _check_date(value: str, col: int, length: int) -> None:
    if not _DATE_RE.match(value):
        raise DslError(
            type=ErrorType.invalid_date_format,
            detail=f"date must be YYYY-MM-DD, got {value!r} at column {col}",
            column=col,
            length=length,
        )
    try:
        datetime.date.fromisoformat(value)
    except ValueError as e:
        raise DslError(
            type=ErrorType.invalid_date_format,
            detail=f"invalid date {value!r} at column {col}",
            column=col,
            length=length,
        ) from e
