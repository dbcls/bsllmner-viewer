from __future__ import annotations

from bsllmner_viewer.dsl.compile import compile_condition, like_pattern
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.parser import parse

FIELDS = FieldSet(("disease",))


def test_compile_none_is_true() -> None:
    assert compile_condition(None, FIELDS).sql == "TRUE"


def test_compile_term_uses_closure_semi_join() -> None:
    pred = compile_condition(parse('disease:"MONDO:1"'), FIELDS)
    assert "annotation_closure" in pred.sql
    assert pred.params == ["disease", "MONDO:1"]


def test_compile_status_group_expands_to_statuses() -> None:
    pred = compile_condition(parse("disease_status:unmapped"), FIELDS)
    assert pred.params == ["disease", "unmapped_no_candidate", "unmapped_rejected"]


def test_compile_boolean_structure_and_parameter_order() -> None:
    pred = compile_condition(parse("NOT organism_id:9606 AND (library_strategy:a OR title:b)"), FIELDS)
    assert pred.sql == "(NOT (r.organism_id = ?) AND (r.library_strategy = ? OR r.title_norm LIKE ? ESCAPE '\\'))"
    assert pred.params == [9606, "a", "%b%"]


def test_like_pattern_escapes_wildcards_and_casefolds() -> None:
    assert like_pattern("50%_A\\") == "%50\\%\\_a\\\\%"


def test_compile_date_range_and_identifier() -> None:
    pred = compile_condition(parse("date_created:[2015-01-01 TO 2020-12-31] AND identifier:SRX1"), FIELDS)
    assert pred.params == ["2015-01-01", "2020-12-31", "SRX1", "SRX1"]
