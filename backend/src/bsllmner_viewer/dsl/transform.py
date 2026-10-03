"""AST transformations used by aggregations and by element selection."""

from __future__ import annotations

from collections.abc import Iterable

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Node, leaves


def conjuncts(ast: Node | None) -> tuple[Node, ...]:
    """Top-level conjuncts: children of a root AND, or the root itself."""
    if ast is None:
        return ()
    if isinstance(ast, BoolOp) and ast.op == "AND":
        return ast.children
    return (ast,)


def from_conjuncts(items: Iterable[Node]) -> Node | None:
    nodes = tuple(items)
    if not nodes:
        return None
    if len(nodes) == 1:
        return nodes[0]
    return BoolOp(op="AND", children=nodes)


def replace_keywords(ast: Node | None, keywords: Iterable[FreeText]) -> Node | None:
    """Replace the keywords among the top-level conjuncts with the given ones, which are added after the others."""
    kept = [item for item in conjuncts(ast) if not isinstance(item, FreeText)]
    return from_conjuncts([*kept, *keywords])


def exclude_dimensions(ast: Node | None, dimensions: Iterable[str]) -> Node | None:
    """Remove every top-level conjunct whose clauses are all on the given fields. A conjunct with a keyword stays."""
    dims = set(dimensions)
    kept = [
        c for c in conjuncts(ast) if not (leaves(c) and not _has_keyword(c) and all(f.field in dims for f in leaves(c)))
    ]
    return from_conjuncts(kept)


def _has_keyword(node: Node) -> bool:
    if isinstance(node, FreeText):
        return True
    return isinstance(node, BoolOp) and any(_has_keyword(c) for c in node.children)


def _same_clause(a: FieldClause, b: FieldClause) -> bool:
    return a.field == b.field and a.value == b.value


def _group_field(node: Node) -> str | None:
    """The field of a top-level clause, or of a top-level OR of clauses on one field, and None for any other node."""
    if isinstance(node, FieldClause):
        return node.field
    if isinstance(node, BoolOp) and node.op == "OR" and all(isinstance(c, FieldClause) for c in node.children):
        fields = {c.field for c in node.children if isinstance(c, FieldClause)}
        return next(iter(fields)) if len(fields) == 1 else None
    return None


def _group_clauses(node: Node) -> tuple[FieldClause, ...]:
    if isinstance(node, FieldClause):
        return (node,)
    if isinstance(node, BoolOp):
        return tuple(c for c in node.children if isinstance(c, FieldClause))
    return ()


def _find_group(ast: Node | None, field: str) -> int:
    for index, conj in enumerate(conjuncts(ast)):
        if _group_field(conj) == field:
            return index
    return -1


def selected_clauses(ast: Node | None) -> list[FieldClause]:
    """The clauses that selecting an element treats as present, in document order.

    These are the top-level clauses and the clauses of a top-level OR on one field, outside any NOT.
    """
    return [c for conj in conjuncts(ast) if _group_field(conj) is not None for c in _group_clauses(conj)]


def contains_clause(ast: Node | None, clause: FieldClause) -> bool:
    return any(_same_clause(c, clause) for c in selected_clauses(ast))


def add_clause(ast: Node | None, clause: FieldClause) -> Node:
    """Join with OR into the first top-level clause group of the same field, or add a new conjunct with AND.

    A clause that is already selected is not added again.
    """
    items = list(conjuncts(ast))
    if contains_clause(ast, clause):
        return from_conjuncts(items)  # type: ignore[return-value]
    index = _find_group(ast, clause.field)
    if index < 0:
        items.append(clause)
    else:
        items[index] = BoolOp(op="OR", children=(*_group_clauses(items[index]), clause))
    result = from_conjuncts(items)
    assert result is not None
    return result


def remove_clause(ast: Node | None, clause: FieldClause) -> Node | None:
    """Remove the clause from every top-level clause group of its field, dropping a conjunct that becomes empty."""
    items: list[Node] = []
    for conj in conjuncts(ast):
        if _group_field(conj) != clause.field:
            items.append(conj)
            continue
        group = _group_clauses(conj)
        remaining = tuple(c for c in group if not _same_clause(c, clause))
        if len(remaining) == len(group):
            items.append(conj)
        elif len(remaining) == 1:
            items.append(remaining[0])
        elif remaining:
            items.append(BoolOp(op="OR", children=remaining))
    return from_conjuncts(items)


def select_element(ast: Node | None, clauses: Iterable[FieldClause]) -> Node | None:
    """Toggle an element: remove its clauses when all of them are present, otherwise add the missing ones."""
    clause_list = list(clauses)
    if clause_list and all(contains_clause(ast, c) for c in clause_list):
        for c in clause_list:
            ast = remove_clause(ast, c)
        return ast
    for c in clause_list:
        ast = add_clause(ast, c)
    return ast


def narrow(ast: Node | None, clauses: Iterable[FieldClause]) -> Node | None:
    """Add each clause as a top-level conjunct. A clause that already is a top-level conjunct is not repeated."""
    items = list(conjuncts(ast))
    for clause in clauses:
        if not any(isinstance(item, FieldClause) and _same_clause(item, clause) for item in items):
            items.append(clause)
    return from_conjuncts(items)


def named_values(ast: Node | None, field: str) -> list[str]:
    """Values of the selected clauses on a field, in document order."""
    values: list[str] = []
    for clause in selected_clauses(ast):
        if clause.field != field:
            continue
        if clause.value_kind in ("word", "phrase") and isinstance(clause.value, str) and clause.value not in values:
            values.append(clause.value)
    return values
