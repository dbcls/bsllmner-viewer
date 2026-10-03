from __future__ import annotations

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, Node, leaves, normalize, structurally_equal
from bsllmner_viewer.dsl.transform import (
    conjuncts,
    contains_clause,
    exclude_dimensions,
    from_conjuncts,
    named_values,
    narrow,
    select_element,
    selected_clauses,
)
from tests.strategies import asts, clauses, flat_asts


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


@settings(max_examples=300)
@given(st.one_of(st.none(), asts), st.lists(clauses, max_size=3))
def test_narrowing_keeps_every_conjunct_and_adds_each_clause_as_one(ast: Node | None, added: list[FieldClause]) -> None:
    out = conjuncts(narrow(ast, added))
    before = conjuncts(ast)
    assert all(structurally_equal(a, b) for a, b in zip(out, before, strict=False))
    for clause in added:
        assert any(isinstance(c, FieldClause) and c.field == clause.field and c.value == clause.value for c in out)


@settings(max_examples=300)
@given(st.one_of(st.none(), asts), st.lists(clauses, max_size=3))
def test_narrowing_twice_equals_narrowing_once(ast: Node | None, added: list[FieldClause]) -> None:
    once = narrow(ast, added)
    twice = narrow(once, added)
    assert len(conjuncts(twice)) == len(conjuncts(once))


@settings(max_examples=300)
@given(flat_asts, clauses)
def test_a_selected_word_or_phrase_clause_is_a_named_value(ast: Node | None, clause: FieldClause) -> None:
    out = select_element(ast, [clause])
    named = named_values(out, clause.field)
    if contains_clause(out, clause) and clause.value_kind in ("word", "phrase"):
        assert clause.value in named
    assert all(isinstance(v, str) for v in named)


@settings(max_examples=200)
@given(st.one_of(st.none(), asts), clauses)
def test_excluding_a_dimension_removes_every_named_value_of_it(ast: Node | None, clause: FieldClause) -> None:
    combined = from_conjuncts([*conjuncts(ast), clause])
    assert combined is not None
    assert named_values(exclude_dimensions(normalize(combined), [clause.field]), clause.field) == []


def _keys(ast: Node | None) -> set[tuple[str, str]]:
    return {(c.field, str(c.value)) for c in selected_clauses(ast)}


@settings(max_examples=300)
@given(st.one_of(st.none(), asts), clauses)
def test_toggling_a_selected_clause_removes_it_from_the_selected_clauses(ast: Node | None, extra: FieldClause) -> None:
    base = from_conjuncts([*conjuncts(None if ast is None else normalize(ast)), extra, extra])
    assert base is not None
    base = normalize(base)
    for chosen in selected_clauses(base):
        result = select_element(base, [chosen])
        assert (chosen.field, str(chosen.value)) not in _keys(result)
        assert _keys(result) == _keys(base) - {(chosen.field, str(chosen.value))}


@settings(max_examples=300)
@given(st.one_of(st.none(), asts), clauses)
def test_toggling_an_unselected_clause_adds_it_to_the_selected_clauses(ast: Node | None, clause: FieldClause) -> None:
    base = None if ast is None else normalize(ast)
    assume((clause.field, str(clause.value)) not in _keys(base))
    assert (clause.field, str(clause.value)) in _keys(select_element(base, [clause]))


@settings(max_examples=300)
@given(st.one_of(st.none(), asts), clauses)
def test_contains_clause_agrees_with_the_selected_clauses(ast: Node | None, clause: FieldClause) -> None:
    base = None if ast is None else normalize(ast)
    assert contains_clause(base, clause) == ((clause.field, str(clause.value)) in _keys(base))


@settings(max_examples=200)
@given(asts, clauses)
def test_selected_clauses_are_clauses_of_the_condition_outside_any_not(ast: Node, clause: FieldClause) -> None:
    negated = BoolOp(op="NOT", children=(clause,))
    assert selected_clauses(negated) == []
    base = normalize(ast)
    assert all(c in leaves(base) for c in selected_clauses(base))


def _clause_set(ast: Node | None) -> set[tuple[str, str]]:
    if ast is None:
        return set()
    return {(leaf.field, str(leaf.value)) for leaf in leaves(ast)}
