from __future__ import annotations

from bsllmner_viewer.dsl.ast import FreeText, clause, normalize, structurally_equal
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serializer import serialize
from bsllmner_viewer.dsl.transform import exclude_dimensions, named_values, narrow, replace_keywords, select_element


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


def test_narrow_adds_every_clause_as_a_new_conjunct() -> None:
    cell = [clause("cell_line", "A"), clause("library_strategy", "RNA-Seq")]
    assert _q(narrow(None, cell)) == "cell_line:A AND library_strategy:RNA-Seq"
    assert _q(narrow(parse("title:x"), cell)) == "title:x AND cell_line:A AND library_strategy:RNA-Seq"


def test_narrow_does_not_join_a_clause_into_a_group_of_the_same_field() -> None:
    ast = parse("(cell_line:A OR cell_line:B) AND library_strategy:ChIP-Seq")
    out = narrow(ast, [clause("cell_line", "A"), clause("library_strategy", "RNA-Seq")])
    assert _q(out) == (
        "(cell_line:A OR cell_line:B) AND library_strategy:ChIP-Seq AND cell_line:A AND library_strategy:RNA-Seq"
    )


def test_narrow_does_not_repeat_a_clause_that_is_already_a_conjunct() -> None:
    ast = parse("cell_line:A AND library_strategy:RNA-Seq")
    assert _q(narrow(ast, [clause("cell_line", "A", kind="phrase"), clause("library_strategy", "RNA-Seq")])) == _q(ast)
    assert _q(narrow(parse("NOT cell_line:A"), [clause("cell_line", "A")])) == "NOT cell_line:A AND cell_line:A"


def test_narrow_without_clauses_returns_the_condition() -> None:
    assert narrow(None, []) is None
    assert _q(narrow(parse("title:x"), [])) == "title:x"


def test_named_values_reads_top_level_clauses_and_disjunctions_of_the_field() -> None:
    ast = parse('(disease:"MONDO:1" OR disease:"MONDO:2") AND library_strategy:ATAC-seq AND disease:"MONDO:3"')
    assert named_values(ast, "disease") == ["MONDO:1", "MONDO:2", "MONDO:3"]
    assert named_values(ast, "library_strategy") == ["ATAC-seq"]
    assert named_values(ast, "tissue") == []
    assert named_values(None, "disease") == []


def test_named_values_ignores_negated_mixed_and_nested_clauses() -> None:
    assert named_values(parse('NOT disease:"MONDO:1"'), "disease") == []
    assert named_values(parse('disease:"MONDO:1" OR tissue:"UBERON:1"'), "disease") == []
    assert named_values(parse('(disease:"MONDO:1" AND title:x) OR title:y'), "disease") == []
    assert named_values(parse('title:x AND (disease:"MONDO:1" OR NOT disease:"MONDO:2")'), "disease") == []


def test_named_values_ignores_ranges_and_repeated_values() -> None:
    assert named_values(parse("date_created:[2015-01-01 TO 2020-12-31]"), "date_created") == []
    assert named_values(parse('disease:"MONDO:1" AND disease:"MONDO:1"'), "disease") == ["MONDO:1"]


def test_replace_keywords_keeps_non_keyword_conjuncts_and_adds_the_new_ones_last() -> None:
    ast = parse('hypoxia AND disease:"MONDO:1" AND NOT liver AND library_strategy:ATAC-seq')
    out = replace_keywords(ast, [FreeText("breast cancer"), FreeText("cell line", True)])
    assert _q(out) == 'disease:"MONDO:1" AND NOT liver AND library_strategy:ATAC-seq AND breast cancer AND "cell line"'


def test_replace_keywords_replaces_every_old_top_level_keyword() -> None:
    assert _q(replace_keywords(parse('a AND "b c" AND d'), [FreeText("x")])) == "x"
    assert _q(replace_keywords(parse("a b"), [FreeText("x"), FreeText("y", True)])) == 'x AND "y"'


def test_replace_keywords_with_an_empty_list_removes_the_keywords() -> None:
    assert _q(replace_keywords(parse("a AND disease:x AND b"), [])) == "disease:x"
    assert replace_keywords(parse("a AND b"), []) is None
    assert replace_keywords(None, []) is None


def test_replace_keywords_on_no_condition_gives_the_keywords() -> None:
    assert _q(replace_keywords(None, [FreeText("a")])) == "a"
    assert _q(replace_keywords(None, [FreeText("a"), FreeText("b c", True)])) == 'a AND "b c"'


def test_replace_keywords_does_not_touch_nested_keywords() -> None:
    ast = normalize(parse("(a OR disease:x) AND NOT b AND (c AND d) AND e"))
    out = replace_keywords(ast, [FreeText("z")])
    assert _q(out) == "(a OR disease:x) AND NOT b AND z"


def test_replace_keywords_replaces_keywords_of_a_nested_and_group_once_normalized() -> None:
    ast = normalize(parse("a AND (b AND disease:x)"))
    assert _q(replace_keywords(ast, [FreeText("z")])) == "disease:x AND z"


def test_replace_keywords_on_a_condition_that_is_an_or_of_keywords_adds_the_new_ones_with_and() -> None:
    out = replace_keywords(parse("a OR b"), [FreeText("z")])
    assert _q(out) == "(a OR b) AND z"
    assert structurally_equal(parse(_q(out) or ""), out)  # type: ignore[arg-type]


def test_replace_keywords_with_the_same_keywords_is_idempotent() -> None:
    once = replace_keywords(parse("disease:x"), [FreeText("a")])
    twice = replace_keywords(once, [FreeText("a")])
    assert once is not None
    assert twice is not None
    assert structurally_equal(once, twice)


def test_exclude_dimensions_keeps_a_keyword_conjunct() -> None:
    ast = parse('hypoxia AND disease:"MONDO:1"')
    assert _q(exclude_dimensions(ast, ["disease"])) == "hypoxia"


def test_exclude_dimensions_keeps_a_conjunct_that_mixes_a_keyword_and_a_clause_of_the_dimension() -> None:
    ast = parse('(hypoxia OR disease:"MONDO:1") AND library_strategy:ATAC-seq')
    assert _q(exclude_dimensions(ast, ["disease"])) == serialize(ast)
    negated = parse('NOT (hypoxia AND disease:"MONDO:1")')
    assert _q(exclude_dimensions(negated, ["disease"])) == serialize(negated)


def test_select_element_ignores_keywords_when_joining_clauses() -> None:
    ast = parse("hypoxia AND disease:A")
    assert _q(select_element(ast, [clause("disease", "B")])) == "hypoxia AND (disease:A OR disease:B)"
    assert _q(select_element(ast, [clause("disease", "A")])) == "hypoxia"
    assert _q(narrow(parse("a OR disease:A"), [clause("disease", "A")])) == "(a OR disease:A) AND disease:A"
