from __future__ import annotations

from typing import Any

import pytest

from bsllmner_viewer.build.selectresult import read_entry

FIELDS = ["cell_line", "drug"]


def _entry(
    extracted: Any, results: Any = None, timings: Any = None, search: Any = None, text2term: Any = None
) -> dict[str, Any]:
    return {
        "extract": {"accession": "SAMN1", "extracted": extracted},
        "results": results or {},
        "select_timings": timings or {},
        "search_results": search or {},
        "text2term_results": text2term or {},
    }


def _rows(entry: dict[str, Any]) -> list[tuple[str, int, str | None, str, str | None]]:
    return [
        (r.field, r.value_index, r.extracted_value, r.status, r.term_id) for r in read_entry(entry, FIELDS).annotations
    ]


def test_extraction_failed_applies_to_every_field() -> None:
    assert _rows(_entry(None)) == [
        ("cell_line", 0, None, "extraction_failed", None),
        ("drug", 0, None, "extraction_failed", None),
    ]


def test_not_stated_for_null_absent_and_empty_values() -> None:
    assert _rows(_entry({"cell_line": None, "drug": []})) == [
        ("cell_line", 0, None, "not_stated", None),
        ("drug", 0, None, "not_stated", None),
    ]
    assert _rows(_entry({}))[0][3] == "not_stated"
    assert _rows(_entry({"cell_line": ""}))[0][3] == "not_stated"


def test_mapped_exact_when_no_select_timing() -> None:
    entry = _entry(
        {"cell_line": "HeLa"}, results={"cell_line": [{"value": "HeLa", "term_id": "CVCL:0030", "label": "HeLa"}]}
    )
    assert _rows(entry)[0] == ("cell_line", 0, "HeLa", "mapped_exact", "CVCL:0030")


def test_mapped_selected_when_select_timing_exists() -> None:
    entry = _entry(
        {"cell_line": "Hela cells"},
        results={"cell_line": [{"value": "Hela cells", "term_id": "CVCL:0030", "label": "HeLa"}]},
        timings={"cell_line": {"Hela cells": {"total_duration": 1}}},
    )
    assert _rows(entry)[0][3] == "mapped_selected"


def test_unmapped_rejected_when_candidates_existed() -> None:
    entry = _entry({"cell_line": "H9"}, search={"cell_line": {"H9": [{"term_id": "CVCL:1240"}]}})
    assert _rows(entry)[0] == ("cell_line", 0, "H9", "unmapped_rejected", None)
    entry = _entry({"cell_line": "H9"}, text2term={"cell_line": {"H9": [{"term_id": "CVCL:1240"}]}})
    assert _rows(entry)[0][3] == "unmapped_rejected"


def test_unmapped_no_candidate_when_both_candidate_lists_are_empty_or_absent() -> None:
    entry = _entry({"cell_line": "xyz"}, search={"cell_line": {"xyz": []}}, text2term={"cell_line": {}})
    assert _rows(entry)[0][3] == "unmapped_no_candidate"


def test_result_without_term_id_does_not_count_as_mapped() -> None:
    entry = _entry({"cell_line": "xyz"}, results={"cell_line": [{"value": "xyz", "term_id": None}]})
    assert _rows(entry)[0][3] == "unmapped_no_candidate"


def test_multi_valued_field_yields_one_row_per_distinct_value() -> None:
    entry = _entry(
        {"drug": ["dex", "dox", "dex", 5]},
        results={"drug": [{"value": "dox", "term_id": "CHEBI:28748", "label": "doxorubicin"}]},
        search={"drug": {"dex": [{"term_id": "CHEBI:41879"}]}},
    )
    assert _rows(entry)[1:] == [
        ("drug", 0, "dex", "unmapped_rejected", None),
        ("drug", 1, "dox", "mapped_exact", "CHEBI:28748"),
    ]


def test_entry_without_accession_is_rejected() -> None:
    with pytest.raises(ValueError, match="accession"):
        read_entry({"extract": {"extracted": {}}}, FIELDS)
