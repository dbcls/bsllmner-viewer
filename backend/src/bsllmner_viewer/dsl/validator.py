"""AST validation against a field set."""

from __future__ import annotations

import datetime
import re

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Node, Range
from bsllmner_viewer.dsl.canonical import ORGANISM_ID_MAX, canonical_int
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import STATUS_GROUPS, FieldDef, FieldSet, Operator, expand_status
from bsllmner_viewer.dsl.keyword import word_matches

MAX_DEPTH = 5
MAX_NODES = 512
MAX_KEYWORDS = 16
MAX_KEYWORD_WORDS = 64

TERM_ID_RE = re.compile(r"^[^\s:]+:\S+\Z")
_DATE_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")


def validate(ast: Node, fields: FieldSet, *, max_depth: int = MAX_DEPTH, max_nodes: int = MAX_NODES) -> None:
    """Raise DslError when the AST uses unknown fields, unsupported operators, or invalid values."""
    check_depth(ast, max_depth)
    total = _count(ast)
    if total > max_nodes:
        raise DslError(type=ErrorType.nest_depth_exceeded, detail=f"total node count {total} exceeds limit {max_nodes}")
    _check_nodes(ast, fields)
    _check_keywords(ast)


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
    return "eq"


def _count(node: Node) -> int:
    if isinstance(node, FieldClause | FreeText):
        return 1
    return 1 + sum(_count(c) for c in node.children)


def check_depth(node: Node, max_depth: int) -> None:
    """Raise DslError when the boolean groups of the tree nest deeper than `max_depth`.

    The recursion stops at `max_depth`, so the check is safe for a tree of any depth.
    """
    _check_depth(node, 1, max_depth)


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


def _keywords(node: Node) -> list[FreeText]:
    if isinstance(node, FreeText):
        return [node]
    if isinstance(node, FieldClause):
        return []
    return [keyword for child in node.children for keyword in _keywords(child)]


def _check_keywords(ast: Node) -> None:
    """Every keyword is a scan of the searchable text, so the keywords of a condition are limited in number."""
    keywords = _keywords(ast)
    if len(keywords) > MAX_KEYWORDS:
        raise DslError(
            type=ErrorType.invalid_value,
            detail=f"a condition has at most {MAX_KEYWORDS} keywords, got {len(keywords)}",
            column=keywords[MAX_KEYWORDS].position.column,
            length=keywords[MAX_KEYWORDS].position.length,
        )
    words = 0
    for keyword in keywords:
        words += len(word_matches(keyword))
        if words > MAX_KEYWORD_WORDS:
            raise DslError(
                type=ErrorType.invalid_value,
                detail=f"the keywords of a condition have at most {MAX_KEYWORD_WORDS} words in total",
                column=keyword.position.column,
                length=keyword.position.length,
            )


def _check_nodes(node: Node, fields: FieldSet) -> None:
    if isinstance(node, FreeText):
        if not word_matches(node):
            raise DslError(
                type=ErrorType.invalid_value,
                detail=f"a keyword needs a letter or a digit at column {node.position.column}",
                column=node.position.column,
                length=node.position.length,
            )
        return
    if isinstance(node, BoolOp):
        for child in node.children:
            _check_nodes(child, fields)
        return
    field, _ = resolve_operator(node, fields)
    _check_value(field, node, fields)


def _check_value(field: FieldDef, clause: FieldClause, fields: FieldSet) -> None:
    col, length = clause.position.column, clause.position.length
    if isinstance(clause.value, Range):
        for bound in (clause.value.from_, clause.value.to):
            _check_date(bound, col, length)
        return
    value = clause.value
    if not value:
        raise DslError(type=ErrorType.missing_value, detail=f"empty value at column {col}", column=col, length=length)
    if field.kind == "date":
        _check_date(value, col, length)
    elif field.kind == "status" and not expand_status(value):
        raise DslError(
            type=ErrorType.invalid_value,
            detail=(
                f"{field.name!r} accepts only the status groups {', '.join(STATUS_GROUPS)}, got {value!r} "
                f"at column {col}"
            ),
            column=col,
            length=length,
        )
    elif field.kind == "term" and not TERM_ID_RE.match(value):
        raise DslError(
            type=ErrorType.invalid_value,
            detail=(
                f"{field.name!r} takes a term ID in the form PREFIX:ID, got {value!r} at column {col}; "
                "find term IDs with GET /api/terms"
            ),
            column=col,
            length=length,
        )
    elif field.kind == "assay" and fields.target_assays is not None and value not in fields.target_assays:
        raise DslError(
            type=ErrorType.invalid_value,
            detail=(
                f"{field.name!r} accepts only the assays of the dataset ({', '.join(fields.target_assays)}), "
                f"got {value!r} at column {col}"
            ),
            column=col,
            length=length,
        )
    elif field.kind == "organism" and canonical_int(value, maximum=ORGANISM_ID_MAX) is None:
        raise DslError(
            type=ErrorType.invalid_value,
            detail=(
                f"organism_id must be an NCBI Taxonomy ID written in ASCII digits without a sign or a leading zero, "
                f"at most {ORGANISM_ID_MAX}, at column {col}"
            ),
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
