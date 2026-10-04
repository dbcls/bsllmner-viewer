from __future__ import annotations

from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.build.selectresult import read_entry

FIELDS = ["cell_line", "drug"]
OTHER = "other_field"
ABSENT = object()
VALUES = ["v1", "v2", "v3"]

_extracted_items: st.SearchStrategy[Any] = st.sampled_from([*VALUES, "", 5, None, {"k": "v1"}, ["v1"]])
_extracted_of_field: st.SearchStrategy[Any] = st.one_of(
    st.just(ABSENT),
    st.none(),
    st.sampled_from([*VALUES, ""]),
    st.lists(_extracted_items, max_size=6),
)
_extracted_dict = st.fixed_dictionaries(dict.fromkeys([*FIELDS, OTHER], _extracted_of_field))
_extracted_whole: st.SearchStrategy[Any] = st.one_of(
    st.just(None), st.just("text"), st.just([]), _extracted_dict, _extracted_dict, _extracted_dict
)


@st.composite
def _result_item(draw: st.DrawFn) -> dict[str, Any]:
    item: dict[str, Any] = {
        "value": draw(st.sampled_from(VALUES)),
        "term_id": draw(st.sampled_from([None, "T:1", "T:2"])),
        "exact_match": draw(st.sampled_from([True, False, None, ABSENT])),
        "reasoning": draw(st.sampled_from([None, "why", ABSENT])),
    }
    return {k: v for k, v in item.items() if v is not ABSENT}


_results_of_field = st.lists(_result_item(), max_size=5)
_timings_of_field = st.dictionaries(st.sampled_from(VALUES), st.just({"total_duration": 1}))
_candidates_of_field = st.dictionaries(st.sampled_from(VALUES), st.sampled_from([[], [{"term_id": "X:1"}]]), max_size=3)


def _per_field(strategy: st.SearchStrategy[Any]) -> st.SearchStrategy[dict[str, Any]]:
    return st.fixed_dictionaries(dict.fromkeys([*FIELDS, OTHER], strategy))


def _expected(entry: dict[str, Any]) -> list[tuple[str, int, str | None, str, str | None]]:
    """The annotation rows that the table in docs/build.md gives for the entry."""
    extracted = entry["extract"]["extracted"]
    rows: list[tuple[str, int, str | None, str, str | None]] = []
    for field in FIELDS:
        if not isinstance(extracted, dict):
            rows.append((field, 0, None, "extraction_failed", None))
            continue
        raw = extracted.get(field)
        items = raw if isinstance(raw, list) else [raw]
        values: list[str] = []
        for item in items:
            if isinstance(item, str) and item != "" and item not in values:
                values.append(item)
        if not values:
            rows.append((field, 0, None, "not_stated", None))
            continue
        for index, value in enumerate(values):
            mapped = [r["term_id"] for r in entry["results"][field] if r["value"] == value and r["term_id"] is not None]
            if mapped:
                selected = value in entry["select_timings"][field]
                rows.append((field, index, value, "mapped_selected" if selected else "mapped_exact", mapped[0]))
                continue
            candidates = entry["search_results"][field].get(value) or entry["text2term_results"][field].get(value)
            rows.append((field, index, value, "unmapped_rejected" if candidates else "unmapped_no_candidate", None))
    return rows


@given(
    extracted=_extracted_whole,
    results=_per_field(_results_of_field),
    timings=_per_field(_timings_of_field),
    search=_per_field(_candidates_of_field),
    text2term=_per_field(_candidates_of_field),
)
def test_read_entry_status_and_term_follow_the_rules_of_build_md_for_any_items_of_a_field(
    extracted: Any,
    results: dict[str, Any],
    timings: dict[str, Any],
    search: dict[str, Any],
    text2term: dict[str, Any],
) -> None:
    if isinstance(extracted, dict):
        extracted = {k: v for k, v in extracted.items() if v is not ABSENT}
    entry = {
        "extract": {"accession": "SAMN1", "extracted": extracted},
        "results": results,
        "select_timings": timings,
        "search_results": search,
        "text2term_results": text2term,
    }
    got = [
        (r.field, r.value_index, r.extracted_value, r.status, r.term_id) for r in read_entry(entry, FIELDS).annotations
    ]
    assert got == _expected(entry)
