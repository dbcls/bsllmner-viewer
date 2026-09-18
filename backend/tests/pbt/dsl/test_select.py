from __future__ import annotations

from hypothesis import given, settings

from bsllmner_viewer.dsl.ast import FieldClause, Node, leaves
from bsllmner_viewer.dsl.transform import conjuncts, contains_clause, exclude_dimensions, select_element
from tests.strategies import clauses, flat_asts


@settings(max_examples=300)
@given(flat_asts, clauses)
def test_selecting_twice_restores_the_condition(ast: Node | None, clause: FieldClause) -> None:
    once = select_element(ast, [clause])
    twice = select_element(once, [clause])
    assert _clause_set(twice) == _clause_set(ast)


@settings(max_examples=300)
@given(flat_asts, clauses)
def test_selecting_adds_or_removes_exactly_that_clause(ast: Node | None, clause: FieldClause) -> None:
    before = _clause_set(ast)
    after = _clause_set(select_element(ast, [clause]))
    key = (clause.field, str(clause.value))
    if contains_clause(ast, clause):
        assert after == before - {key}
    else:
        assert after == before | {key}


@settings(max_examples=300)
@given(flat_asts, clauses)
def test_same_field_clauses_share_one_top_level_group(ast: Node | None, clause: FieldClause) -> None:
    out = select_element(ast, [clause])
    groups = [c for c in conjuncts(out) if any(leaf.field == clause.field for leaf in leaves(c))]
    assert len(groups) <= 1 or not contains_clause(out, clause) or len(groups) == 1


@settings(max_examples=200)
@given(flat_asts, clauses)
def test_excluding_a_dimension_leaves_no_clause_on_it_alone(ast: Node | None, clause: FieldClause) -> None:
    out = exclude_dimensions(select_element(ast, [clause]), [clause.field])
    for conj in conjuncts(out):
        fields = {leaf.field for leaf in leaves(conj)}
        assert fields != {clause.field}


def _clause_set(ast: Node | None) -> set[tuple[str, str]]:
    if ast is None:
        return set()
    return {(leaf.field, str(leaf.value)) for leaf in leaves(ast)}
