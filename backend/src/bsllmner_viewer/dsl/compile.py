"""AST to a SQL predicate over the `population` table."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from bsllmner_viewer.dsl.ast import FieldClause, FreeText, Node, Range
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet, expand_status
from bsllmner_viewer.dsl.keyword import Accession, word_matches
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
        return _keyword(node, alias)
    if isinstance(node, FieldClause):
        return _clause(node, fields, alias)
    parts = [_node(c, fields, alias) for c in node.children]
    params = [p for part in parts for p in part.params]
    if node.op == "NOT":
        return Predicate(f"NOT ({parts[0].sql})", params)
    joiner = " AND " if node.op == "AND" else " OR "
    return Predicate("(" + joiner.join(p.sql for p in parts) + ")", params)


def _clause(clause: FieldClause, fields: FieldSet, alias: str) -> Predicate:
    field_def, op = resolve_operator(clause, fields)
    value = clause.value
    if field_def.kind == "term":
        return Predicate(
            f"{alias}.biosample IN (SELECT biosample FROM annotation_closure WHERE field = ? AND ancestor = ?)",
            [field_def.annotation_field, value],
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
            return Predicate(f"{alias}.date_published BETWEEN ? AND ?", [value.from_, value.to])
        return Predicate(f"{alias}.date_published = ?", [value])
    return Predicate(
        f"{alias}.biosample IN (SELECT biosample FROM biosample_bioproject WHERE bioproject = ?)",
        [value],
    )


def _keyword(node: FreeText, alias: str) -> Predicate:
    """Every word must hold: an accession word against the accessions, the others against the searchable text."""
    matches = word_matches(node)
    if not matches:
        raise DslError(type=ErrorType.invalid_value, detail="a keyword needs a letter or a digit")
    conditions: list[str] = []
    params: list[Any] = []
    text_conditions: list[str] = []
    text_params: list[str] = []
    for match in matches:
        if isinstance(match, Accession):
            conditions.append(_ACCESSION_SQL[match.kind].format(alias=alias))
            params.append(match.accession)
            continue
        text_conditions.append("(" + " OR ".join("text LIKE ?" for _ in match.patterns) + ")")
        text_params.extend(match.patterns)
    if text_conditions:
        conditions.append(
            f"{alias}.biosample IN (SELECT biosample FROM searchable_text WHERE {' AND '.join(text_conditions)})"
        )
        params.extend(text_params)
    return Predicate("(" + " AND ".join(conditions) + ")", params)


_ACCESSION_SQL = {
    "biosample": "{alias}.biosample = ?",
    "experiment": "{alias}.experiment = ?",
    "run": "{alias}.experiment IN (SELECT experiment FROM sra_run WHERE accession = ?)",
    "bioproject": "{alias}.biosample IN (SELECT biosample FROM biosample_bioproject WHERE bioproject = ?)",
}
