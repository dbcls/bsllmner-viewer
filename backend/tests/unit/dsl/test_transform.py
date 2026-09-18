from __future__ import annotations

from bsllmner_viewer.dsl.ast import clause, structurally_equal
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serializer import serialize
from bsllmner_viewer.dsl.transform import exclude_dimensions, select_element


def _q(ast: object) -> str | None:
    return None if ast is None else serialize(ast)  # type: ignore[arg-type]


def test_exclude_dimensions_drops_conjuncts_only_on_the_dimension() -> None:
    ast = parse('library_strategy:ATAC-seq AND disease:"MONDO:1" AND NOT disease:"MONDO:2"')
    assert _q(exclude_dimensions(ast, ["disease"])) == "library_strategy:ATAC-seq"


def test_exclude_dimensions_keeps_mixed_conjuncts() -> None:
    ast = parse('(disease:"MONDO:1" OR tissue:"UBERON:1") AND library_strategy:ATAC-seq')
    assert _q(exclude_dimensions(ast, ["disease"])) == serialize(ast)
    assert _q(exclude_dimensions(ast, ["disease", "tissue"])) == "library_strategy:ATAC-seq"


def test_exclude_dimensions_returns_none_when_everything_is_removed() -> None:
    assert exclude_dimensions(parse('disease:"MONDO:1"'), ["disease"]) is None
    assert exclude_dimensions(None, ["disease"]) is None


def test_exclude_dimensions_treats_status_as_its_own_field() -> None:
    ast = parse('disease:"MONDO:1" AND disease_status:mapped')
    assert _q(exclude_dimensions(ast, ["disease"])) == "disease_status:mapped"


def test_select_element_builds_the_documented_example() -> None:
    ast = select_element(None, [clause("disease", "A")])
    ast = select_element(ast, [clause("library_strategy", "ATAC-seq")])
    ast = select_element(ast, [clause("disease", "B")])
    assert _q(ast) == "(disease:A OR disease:B) AND library_strategy:ATAC-seq"


def test_select_element_removes_a_present_clause() -> None:
    ast = parse("(disease:A OR disease:B) AND library_strategy:ATAC-seq")
    assert _q(select_element(ast, [clause("disease", "A")])) == "disease:B AND library_strategy:ATAC-seq"
    assert _q(select_element(parse("disease:A"), [clause("disease", "A")])) is None


def test_select_element_ignores_value_kind_when_matching() -> None:
    ast = parse('disease:"MONDO:1"')
    assert select_element(ast, [clause("disease", "MONDO:1", kind="word")]) is None


def test_select_element_does_not_merge_into_negated_or_nested_groups() -> None:
    ast = parse("NOT disease:A")
    assert _q(select_element(ast, [clause("disease", "B")])) == "NOT disease:A AND disease:B"
    ast = parse("(disease:A OR tissue:T)")
    assert _q(select_element(ast, [clause("disease", "B")])) == "(disease:A OR tissue:T) AND disease:B"


def test_select_element_with_two_clauses_adds_missing_and_removes_when_all_present() -> None:
    cell = [clause("cell_line", "CVCL:1"), clause("library_strategy", "ATAC-seq")]
    ast = select_element(parse('cell_line:"CVCL:1"'), cell)
    assert _q(ast) == 'cell_line:"CVCL:1" AND library_strategy:ATAC-seq'
    assert select_element(ast, cell) is None


def test_select_element_keeps_other_conjuncts_intact() -> None:
    ast = parse("title:x AND date_created:[2015-01-01 TO 2020-12-31]")
    out = select_element(ast, [clause("disease", "A")])
    assert out is not None
    assert structurally_equal(out, parse("title:x AND date_created:[2015-01-01 TO 2020-12-31] AND disease:A"))
