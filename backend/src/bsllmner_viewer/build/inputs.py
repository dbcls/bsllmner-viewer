"""Reader for the BioSample JSONL given to a run.

Each line is a BioSample entry as exported from NCBI BioSample XML, either wrapped as
`{"BioSample": {...}, "accession": ...}` or with the same members at the top level.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import orjson


@dataclass(slots=True)
class Attribute:
    name: str
    value: str
    harmonized_name: str | None = None


@dataclass(slots=True)
class InputDoc:
    accession: str
    organism_id: int | None
    organism_name: str | None
    title: str | None
    date_published: datetime.date | None
    attributes: list[Attribute] = field(default_factory=list)


def read_input(path: Path) -> Iterator[InputDoc]:
    with path.open("rb") as f:
        for raw in f:
            if raw.strip():
                yield parse_input_doc(orjson.loads(raw))


def parse_input_doc(doc: dict[str, Any]) -> InputDoc:
    wrapped = doc.get("BioSample")
    body: dict[str, Any] = wrapped if isinstance(wrapped, dict) else doc
    accession = doc.get("accession") or body.get("accession")
    if not isinstance(accession, str) or not accession:
        raise ValueError("input document without accession")
    description = body.get("Description") or {}
    organism = description.get("Organism") or {}
    taxonomy_id = organism.get("taxonomy_id")
    title = description.get("Title")
    return InputDoc(
        accession=accession,
        organism_id=int(taxonomy_id) if isinstance(taxonomy_id, str) and taxonomy_id.isdigit() else None,
        organism_name=organism.get("OrganismName") or organism.get("taxonomy_name"),
        title=title if isinstance(title, str) else None,
        date_published=parse_date(body.get("publication_date")),
        attributes=_attributes(body),
    )


def _attributes(body: dict[str, Any]) -> list[Attribute]:
    holder = body.get("Attributes")
    raw = holder.get("Attribute") if isinstance(holder, dict) else None
    items = raw if isinstance(raw, list) else ([raw] if isinstance(raw, dict) else [])
    out: list[Attribute] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = item.get("attribute_name")
        value = item.get("content")
        if isinstance(name, str) and isinstance(value, str):
            harmonized = item.get("harmonized_name")
            out.append(Attribute(name, value, harmonized if isinstance(harmonized, str) else None))
    return out


def parse_datetime(value: Any) -> datetime.datetime | None:
    """ISO 8601 with or without offset; aware values are converted to UTC and returned naive."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(datetime.UTC).replace(tzinfo=None)
    return parsed


def parse_date(value: Any) -> datetime.date | None:
    parsed = parse_datetime(value)
    return parsed.date() if parsed else None


EARLIEST_PUBLICATION_DATE = datetime.date(2005, 1, 1)


def plausible_publication_date(
    published: datetime.date | None, run_start: datetime.datetime | None
) -> datetime.date | None:
    """The publication date, or None when it cannot be the day on which the BioSample became public.

    A date before 2005 is a placeholder such as 2000-01-01: the sequencing assays of a dataset produced no data that
    early. A date after the start of the run is a planned release date: the run analyzed the BioSample after it had
    become public.
    """
    if published is None or published < EARLIEST_PUBLICATION_DATE:
        return None
    if run_start is not None:
        start = run_start.astimezone(datetime.UTC) if run_start.tzinfo is not None else run_start
        if published > start.date():
            return None
    return published
