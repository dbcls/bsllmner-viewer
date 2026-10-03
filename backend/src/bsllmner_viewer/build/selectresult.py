"""Reader for the parts of a bsllmner-mk2 SelectResult that build needs."""

from __future__ import annotations

import datetime
import json
import mmap
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import orjson
from pydantic import BaseModel, ConfigDict, ValidationError

from bsllmner_viewer.build.errors import BuildError
from bsllmner_viewer.dsl.fields import Status

_RUN_METADATA_KEY = b'"run_metadata"'
_METADATA_WINDOW = 1 << 16
_AFTER_KEY = re.compile(r"\s*:\s*\{")


class RunMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    run_name: str
    model: str
    status: Literal["running", "completed", "failed", "interrupted"]
    start_time: datetime.datetime | None = None


@dataclass(slots=True)
class AnnotationRow:
    field: str
    value_index: int
    extracted_value: str | None
    status: Status
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
    try:
        data = orjson.loads(path.read_bytes())
    except orjson.JSONDecodeError as e:
        raise BuildError(f"{path.name}: invalid JSON: {e}") from e
    entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        raise BuildError(f"{path.name}: 'entries' is not a list")
    return _run_metadata(path, data.get("run_metadata")), entries


def read_run_metadata(path: Path) -> RunMetadata:
    """The `run_metadata` of a result file, without parsing the entries when the file allows it.

    The object after the last `"run_metadata"` of the file is decoded in place. The whole file is parsed whenever that
    does not give a valid `run_metadata`: when the text is not a key followed by an object, or when the object is
    invalid.
    """
    try:
        with path.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mapped:
            at = mapped.rfind(_RUN_METADATA_KEY)
            if at >= 0:
                start = at + len(_RUN_METADATA_KEY)
                text = mapped[start : start + _METADATA_WINDOW].decode("utf-8", errors="ignore")
                opening = _AFTER_KEY.match(text)
                if opening:
                    value, _ = json.JSONDecoder().raw_decode(text, opening.end() - 1)
                    return _run_metadata(path, value)
    except (ValueError, OSError, BuildError):
        pass
    return load_select_result(path)[0]


def _run_metadata(path: Path, raw: Any) -> RunMetadata:
    try:
        return RunMetadata.model_validate(raw or {})
    except ValidationError as e:
        raise BuildError(f"{path.name}: invalid run_metadata: {e}") from e


def iter_entries(entries: list[dict[str, Any]], fields: list[str]) -> Iterator[ResultEntry]:
    for raw in entries:
        yield read_entry(raw, fields)


def read_entry(raw: dict[str, Any], fields: list[str]) -> ResultEntry:
    """Derive one annotation row per extracted value (or one per field without a value)."""
    extract = raw.get("extract")
    if not isinstance(extract, dict):
        raise ValueError("SelectResult entry without accession")
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
        if not isinstance(extracted, dict):
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
        mapped: Status = "mapped_selected" if selected else "mapped_exact"
        label = picked.get("label")
        return AnnotationRow(
            field, index, value, mapped, str(picked["term_id"]), label if isinstance(label, str) else None
        )
    has_candidate = bool((search.get(field) or {}).get(value)) or bool((text2term.get(field) or {}).get(value))
    unmapped: Status = "unmapped_rejected" if has_candidate else "unmapped_no_candidate"
    return AnnotationRow(field, index, value, unmapped, None, None)
