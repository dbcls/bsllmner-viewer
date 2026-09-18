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


def exclude_dimensions(ast: Node | None, dimensions: Iterable[str]) -> Node | None:
    """Remove every top-level conjunct whose clauses are all on the given fields."""
    dims = set(dimensions)
    kept = [c for c in conjuncts(ast) if not (leaves(c) and all(leaf.field in dims for leaf in leaves(c)))]
    return from_conjuncts(kept)


def _same_clause(a: FieldClause, b: FieldClause) -> bool:
    return a.field == b.field and a.value == b.value


def _is_positive_clause_group(node: Node, field: str) -> bool:
    if isinstance(node, FieldClause):
        return node.field == field
    return (
        isinstance(node, BoolOp)
        and node.op == "OR"
        and all(isinstance(c, FieldClause) and c.field == field for c in node.children)
    )


def _group_clauses(node: Node) -> tuple[FieldClause, ...]:
    if isinstance(node, FreeText):
        return ()
    if isinstance(node, FieldClause):
        return (node,)
    return tuple(c for c in node.children if isinstance(c, FieldClause))


def _find_group(ast: Node | None, field: str) -> int:
    for index, conj in enumerate(conjuncts(ast)):
        if _is_positive_clause_group(conj, field):
            return index
    return -1


def contains_clause(ast: Node | None, clause: FieldClause) -> bool:
    """True when the clause is in the top-level clause group of its field."""
    index = _find_group(ast, clause.field)
    if index < 0:
        return False
    return any(_same_clause(c, clause) for c in _group_clauses(conjuncts(ast)[index]))


def add_clause(ast: Node | None, clause: FieldClause) -> Node:
    """Join with OR into the top-level clause group of the same field, or add a new conjunct with AND."""
    items = list(conjuncts(ast))
    index = _find_group(ast, clause.field)
    if index < 0:
        items.append(clause)
    else:
        group = _group_clauses(items[index])
        if any(_same_clause(c, clause) for c in group):
            return from_conjuncts(items)  # type: ignore[return-value]
        items[index] = BoolOp(op="OR", children=(*group, clause))
    result = from_conjuncts(items)
    assert result is not None
    return result


def remove_clause(ast: Node | None, clause: FieldClause) -> Node | None:
    """Remove the clause from the top-level clause group of its field, dropping the conjunct if it becomes empty."""
    items = list(conjuncts(ast))
    index = _find_group(ast, clause.field)
    if index < 0:
        return ast
    remaining = tuple(c for c in _group_clauses(items[index]) if not _same_clause(c, clause))
    if len(remaining) == len(_group_clauses(items[index])):
        return ast
    if not remaining:
        del items[index]
    elif len(remaining) == 1:
        items[index] = remaining[0]
    else:
        items[index] = BoolOp(op="OR", children=remaining)
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
