"""Properties of the lines and the cells of the exports."""

from __future__ import annotations

import json
from itertools import pairwise
from urllib.parse import unquote

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.api.routers.export import _annotation_cell, _plain_cell, dataset_version
from bsllmner_viewer.api.schemas import AnnotationValue, DatasetVersionRef
from bsllmner_viewer.dsl.ast import Node
from bsllmner_viewer.dsl.fields import STATUSES
from tests.api_helpers import condition_q
from tests.strategies import conditions

ACCESSION_TYPES = ["biosample", "sra-experiment", "sra-run", "bioproject"]
DELIMITERS = "%|;\t\r\n éβa="
texts = st.one_of(st.text(), st.text(alphabet=DELIMITERS, max_size=12))


@settings(max_examples=30)
@given(conditions, st.sampled_from(ACCESSION_TYPES))
def test_accession_export_lines_are_ascending_and_unique_for_every_type(
    client: TestClient, ast: Node | None, type_: str
) -> None:
    q = condition_q(ast)
    response = client.get(f"/api/export/accessions/{type_}", params={"q": q} if q else {})
    assert response.status_code == 200, response.text
    lines = response.text.splitlines()
    assert lines[0].startswith("# ")
    body = lines[1:]
    assert all(a < b for a, b in pairwise(body)), (type_, q)


@given(texts, st.from_regex(r"[0-9A-Za-z:.+-]{0,24}", fullmatch=True), st.from_regex(r"[0-9a-f]{0,16}", fullmatch=True))
def test_dataset_version_is_one_ascii_line_that_gives_back_the_name(name: str, created_at: str, digest: str) -> None:
    version = DatasetVersionRef.model_validate({"name": name, "createdAt": created_at, "model": "m", "digest": digest})
    text = dataset_version(version)
    assert text.isascii()
    assert "\r" not in text
    assert "\n" not in text
    decoded, end = json.JSONDecoder().raw_decode(text)
    assert decoded == name
    assert text[end:] == f" {created_at} {digest}"


annotation_values = st.builds(
    lambda value, status, term_id, label: AnnotationValue.model_validate(
        {"value": value, "status": status, "termId": term_id, "label": label}
    ),
    st.none() | texts,
    st.sampled_from(STATUSES),
    st.none() | texts,
    st.none() | texts,
)


@given(st.lists(annotation_values, min_size=1, max_size=4))
def test_tsv_annotation_cell_splits_back_into_its_parts_and_decodes_to_the_original(
    items: list[AnnotationValue],
) -> None:
    cell = ";".join(_annotation_cell(a) for a in items)
    assert "\t" not in cell
    assert "\r" not in cell
    assert "\n" not in cell
    pieces = cell.split(";")
    assert len(pieces) == len(items)
    for piece, item in zip(pieces, items, strict=True):
        parts = piece.split("|")
        assert len(parts) == 4
        original = (item.value, item.term_id, item.label, item.status)
        assert tuple(unquote(p) for p in parts) == tuple(o or "" for o in original)


@given(st.one_of(texts, st.text(alphabet="=+-@\t\r\n x", max_size=12)))
def test_plain_cell_replaces_only_tabs_and_line_breaks_with_a_space(value: str) -> None:
    assert _plain_cell(value) == value.replace("\t", " ").replace("\r", " ").replace("\n", " ")
