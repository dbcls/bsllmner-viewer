"""AST to a SQL predicate over the `population` table."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from bsllmner_viewer.dsl.ast import FieldClause, FreeText, Node, Range
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet, expand_status
from bsllmner_viewer.dsl.validator import resolve_operator


@dataclass
class Predicate:
    """A SQL boolean expression with positional parameters."""

    sql: str
    params: list[Any] = field(default_factory=list)


def compile_condition(ast: Node | None, fields: FieldSet, alias: str = "pn") -> Predicate:
    """Compile a validated AST. `None` compiles to `TRUE`."""
    if ast is None:
        return Predicate("TRUE")
    return _node(ast, fields, alias)


def _node(node: Node, fields: FieldSet, alias: str) -> Predicate:
    if isinstance(node, FreeText):
        raise DslError(type=ErrorType.free_text_not_supported, detail="free text is not supported")
    if isinstance(node, FieldClause):
        return _clause(node, fields, alias)
    parts = [_node(c, fields, alias) for c in node.children]
    params = [p for part in parts for p in part.params]
    if node.op == "NOT":
        return Predicate(f"NOT ({parts[0].sql})", params)
    joiner = " AND " if node.op == "AND" else " OR "
    return Predicate("(" + joiner.join(p.sql for p in parts) + ")", params)


def like_pattern(value: str) -> str:
    """A case-insensitive substring pattern for `LIKE ... ESCAPE '\\'` against normalized text."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{normalize_text(escaped)}%"


def normalize_text(value: str) -> str:
    """Normalization applied to stored text and to substring conditions."""
    return value.casefold()


def _clause(clause: FieldClause, fields: FieldSet, alias: str) -> Predicate:
    field_def, op = resolve_operator(clause, fields)
    value = clause.value
    if field_def.kind == "term":
        return Predicate(
            f"{alias}.biosample IN (SELECT biosample FROM annotation_closure WHERE field = ? AND ancestor = ?)",
            [field_def.annotation_field, value],
        )
    if field_def.kind == "value":
        assert isinstance(value, str)
        return Predicate(
            f"{alias}.biosample IN (SELECT biosample FROM annotation WHERE field = ? "
            "AND extracted_value_norm LIKE ? ESCAPE '\\')",
            [field_def.annotation_field, like_pattern(value)],
        )
    if field_def.kind == "status":
        assert isinstance(value, str)
        statuses = expand_status(value)
        placeholders = ", ".join("?" for _ in statuses)
        return Predicate(
            f"{alias}.biosample IN (SELECT biosample FROM annotation WHERE field = ? AND status IN ({placeholders}))",
            [field_def.annotation_field, *statuses],
        )
    if field_def.kind == "assay":
        return Predicate(f"{alias}.library_strategy = ?", [value])
    if field_def.kind == "organism":
        assert isinstance(value, str)
        return Predicate(f"{alias}.organism_id = ?", [int(value)])
    if field_def.kind == "date":
        if op == "between":
            assert isinstance(value, Range)
            return Predicate(f"{alias}.date_created BETWEEN ? AND ?", [value.from_, value.to])
        return Predicate(f"{alias}.date_created = ?", [value])
    if field_def.kind == "bioproject":
        return Predicate(
            f"{alias}.biosample IN (SELECT biosample FROM biosample_bioproject WHERE bioproject = ?)",
            [value],
        )
    if field_def.kind == "identifier":
        return Predicate(f"({alias}.biosample = ? OR {alias}.experiment = ?)", [value, value])
    assert isinstance(value, str)
    return Predicate(f"{alias}.title_norm LIKE ? ESCAPE '\\'", [like_pattern(value)])
