"""AST to a SQL predicate over the `population` table."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from bsllmner_viewer.dsl.ast import FieldClause, FreeText, Node, Range
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet, expand_status
from bsllmner_viewer.dsl.keyword import Accession, word_matches
from bsllmner_viewer.dsl.validator import resolve_operator


@dataclass(frozen=True, slots=True)
class TempTable:
    """A temporary table that a predicate reads, defined by the SELECT that fills it."""

    name: str
    sql: str
    params: tuple[Any, ...]


@dataclass
class Predicate:
    """A SQL boolean expression with positional parameters and the temporary tables it reads."""

    sql: str
    params: list[Any] = field(default_factory=list)
    tables: list[TempTable] = field(default_factory=list)


def compile_condition(ast: Node | None, fields: FieldSet, alias: str = "pn", keyword_tables: bool = False) -> Predicate:
    """Compile a validated AST. `None` compiles to `TRUE`.

    With `keyword_tables`, the BioSamples that match the searchable-text words of a keyword are selected into a
    temporary table that the caller creates, so that the scan of the searchable text runs once however many times the
    predicate is evaluated.
    """
    if ast is None:
        return Predicate("TRUE")
    return _node(ast, fields, alias, keyword_tables)


def _node(node: Node, fields: FieldSet, alias: str, keyword_tables: bool) -> Predicate:
    if isinstance(node, FreeText):
        return _keyword(node, alias, keyword_tables)
    if isinstance(node, FieldClause):
        return _clause(node, fields, alias)
    parts = [_node(c, fields, alias, keyword_tables) for c in node.children]
    params = [p for part in parts for p in part.params]
    tables = list(dict.fromkeys(t for part in parts for t in part.tables))
    if node.op == "NOT":
        return Predicate(f"NOT ({parts[0].sql})", params, tables)
    joiner = " AND " if node.op == "AND" else " OR "
    return Predicate("(" + joiner.join(p.sql for p in parts) + ")", params, tables)


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
        return Predicate(_two_valued(f"{alias}.library_strategy = ?"), [value])
    if field_def.kind == "organism":
        assert isinstance(value, str)
        return Predicate(_two_valued(f"{alias}.organism_id = ?"), [int(value)])
    if field_def.kind == "date":
        if op == "between":
            assert isinstance(value, Range)
            return Predicate(_two_valued(f"{alias}.date_published BETWEEN ? AND ?"), [value.from_, value.to])
        return Predicate(_two_valued(f"{alias}.date_published = ?"), [value])
    return Predicate(
        f"{alias}.biosample IN (SELECT biosample FROM biosample_bioproject WHERE bioproject = ?)",
        [value],
    )


def _two_valued(predicate: str) -> str:
    """A comparison on a column that can be NULL is false for a NULL, so that its negation is true."""
    return f"COALESCE({predicate}, FALSE)"


def _keyword(node: FreeText, alias: str, keyword_tables: bool) -> Predicate:
    """Every word must hold: an accession word against the accessions, the others against the searchable text."""
    # Every word must hold, so a repeated word adds nothing.
    matches = list(dict.fromkeys(word_matches(node)))
    if not matches:
        raise DslError(type=ErrorType.invalid_value, detail="a keyword needs a letter or a digit")
    conditions: list[str] = []
    params: list[Any] = []
    text_conditions: list[str] = []
    text_params: list[str] = []
    tables: list[TempTable] = []
    for match in matches:
        if isinstance(match, Accession):
            conditions.append(_ACCESSION_SQL[match.kind].format(alias=alias))
            params.append(match.accession)
            continue
        text_conditions.append("(" + " OR ".join("text LIKE ?" for _ in match.patterns) + ")")
        text_params.extend(match.patterns)
    if text_conditions:
        select = f"SELECT biosample FROM searchable_text WHERE {' AND '.join(text_conditions)}"
        if keyword_tables:
            table = _keyword_table(select, tuple(text_params))
            tables.append(table)
            conditions.append(f"{alias}.biosample IN (SELECT biosample FROM {table.name})")
        else:
            conditions.append(f"{alias}.biosample IN ({select})")
            params.extend(text_params)
    return Predicate("(" + " AND ".join(conditions) + ")", params, tables)


def _keyword_table(sql: str, params: tuple[Any, ...]) -> TempTable:
    digest = hashlib.sha256(repr((sql, params)).encode()).hexdigest()[:16]
    return TempTable(f"keyword_{digest}", sql, params)


_ACCESSION_SQL = {
    "biosample": "{alias}.biosample = ?",
    "experiment": "{alias}.experiment = ?",
    "run": "{alias}.experiment IN (SELECT experiment FROM sra_run WHERE accession = ?)",
    "bioproject": "{alias}.biosample IN (SELECT biosample FROM biosample_bioproject WHERE bioproject = ?)",
}
