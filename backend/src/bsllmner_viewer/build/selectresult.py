"""Reader for the parts of a bsllmner-mk2 SelectResult that build needs."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import orjson
from pydantic import BaseModel, ConfigDict

from bsllmner_viewer.dsl.fields import STATUSES


class RunMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    run_name: str
    model: str
    status: Literal["running", "completed", "failed", "interrupted"]


@dataclass(slots=True)
class AnnotationRow:
    field: str
    value_index: int
    extracted_value: str | None
    status: str
    term_id: str | None
    term_label: str | None


@dataclass(slots=True)
class ResultEntry:
    accession: str
    annotations: list[AnnotationRow]


class SelectConfig(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    fields: dict[str, SelectConfigField]


class SelectConfigField(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    ontology_file: str | None = None
    value_type: Literal["string", "array"] = "string"


def load_select_config(path: Path) -> SelectConfig:
    return SelectConfig.model_validate(orjson.loads(path.read_bytes()))


def load_select_result(path: Path) -> tuple[RunMetadata, list[dict[str, Any]]]:
    data = orjson.loads(path.read_bytes())
    entries = data.get("entries")
    if not isinstance(entries, list):
        raise ValueError(f"{path}: 'entries' is not a list")
    return RunMetadata.model_validate(data.get("run_metadata") or {}), entries


def iter_entries(entries: list[dict[str, Any]], fields: list[str]) -> Iterator[ResultEntry]:
    for raw in entries:
        yield read_entry(raw, fields)


def read_entry(raw: dict[str, Any], fields: list[str]) -> ResultEntry:
    """Derive one annotation row per extracted value (or one per field without a value)."""
    extract = raw.get("extract") or {}
    accession = extract.get("accession")
    if not isinstance(accession, str) or not accession:
        raise ValueError("SelectResult entry without accession")
    extracted = extract.get("extracted")
    results = raw.get("results") or {}
    timings = raw.get("select_timings") or {}
    search = raw.get("search_results") or {}
    text2term = raw.get("text2term_results") or {}
    rows: list[AnnotationRow] = []
    for field in fields:
        if extracted is None:
            rows.append(AnnotationRow(field, 0, None, "extraction_failed", None, None))
            continue
        values = _values(extracted.get(field))
        if not values:
            rows.append(AnnotationRow(field, 0, None, "not_stated", None, None))
            continue
        for index, value in enumerate(values):
            rows.append(_value_row(field, index, value, results, timings, search, text2term))
    return ResultEntry(accession=accession, annotations=rows)


def _values(raw: Any) -> list[str]:
    if isinstance(raw, str):
        return [raw] if raw else []
    if isinstance(raw, list):
        seen: list[str] = []
        for item in raw:
            if isinstance(item, str) and item and item not in seen:
                seen.append(item)
        return seen
    return []


def _value_row(
    field: str,
    index: int,
    value: str,
    results: dict[str, Any],
    timings: dict[str, Any],
    search: dict[str, Any],
    text2term: dict[str, Any],
) -> AnnotationRow:
    picked = next(
        (r for r in (results.get(field) or []) if isinstance(r, dict) and r.get("value") == value and r.get("term_id")),
        None,
    )
    if picked is not None:
        selected = isinstance(timings.get(field), dict) and value in timings[field]
        status = "mapped_selected" if selected else "mapped_exact"
        label = picked.get("label")
        return AnnotationRow(
            field, index, value, status, str(picked["term_id"]), label if isinstance(label, str) else None
        )
    has_candidate = bool((search.get(field) or {}).get(value)) or bool((text2term.get(field) or {}).get(value))
    status = "unmapped_rejected" if has_candidate else "unmapped_no_candidate"
    return AnnotationRow(field, index, value, status, None, None)


assert set(STATUSES) == {
    "not_stated",
    "extraction_failed",
    "unmapped_no_candidate",
    "unmapped_rejected",
    "mapped_exact",
    "mapped_selected",
}
