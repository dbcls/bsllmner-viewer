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

from bsllmner_viewer.build.errors import BuildError


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
    # (name, value): the description paragraphs, the sample name, and the synonyms.
    description: list[tuple[str, str]] = field(default_factory=list)
    # (path, value): every string of the other members of the entry, without the contacts of the owner.
    record: list[tuple[str, str]] = field(default_factory=list)


def read_input(path: Path) -> Iterator[InputDoc]:
    """The entries of an input file. A line that is not valid raises a BuildError that names the file and the line."""
    with path.open("rb") as f:
        for number, raw in enumerate(f, 1):
            if not raw.strip():
                continue
            try:
                doc = orjson.loads(raw)
                if not isinstance(doc, dict):
                    raise ValueError("the line is not a JSON object")
                yield parse_input_doc(doc)
            except (orjson.JSONDecodeError, ValueError) as e:
                raise BuildError(f"{path.name}:{number}: {e}") from e


def parse_input_doc(doc: dict[str, Any]) -> InputDoc:
    wrapped = doc.get("BioSample")
    body: dict[str, Any] = wrapped if isinstance(wrapped, dict) else doc
    accession = doc.get("accession") or body.get("accession")
    if not isinstance(accession, str) or not accession:
        raise ValueError("input document without accession")
    description = _object(body, "Description")
    organism = _object(description, "Organism")
    title = description.get("Title")
    return InputDoc(
        accession=accession,
        organism_id=_taxonomy_id(organism.get("taxonomy_id")),
        organism_name=organism.get("OrganismName") or organism.get("taxonomy_name"),
        title=title if isinstance(title, str) else None,
        date_published=parse_date(body.get("publication_date")),
        attributes=_attributes(body),
        description=_description(description),
        record=_record(body),
    )


MAX_TAXONOMY_ID = 2**31 - 1
"""The largest taxonomy ID that a store holds (a 32-bit signed integer)."""


def _taxonomy_id(value: Any) -> int | None:
    """The taxonomy ID as an integer from 1 to `MAX_TAXONOMY_ID`, or None when the entry has none.

    The value is an integer or a string of ASCII digits. Any other value raises a ValueError.
    """
    if value is None or value == "":
        return None
    if isinstance(value, str) and value.isascii() and value.isdigit():
        number = int(value)
    elif isinstance(value, int) and not isinstance(value, bool):
        number = value
    else:
        raise ValueError(f"taxonomy_id {value!r} is not an integer")
    if not 1 <= number <= MAX_TAXONOMY_ID:
        raise ValueError(f"taxonomy_id {value!r} is out of range (1 to {MAX_TAXONOMY_ID})")
    return number


def _object(parent: dict[str, Any], key: str) -> dict[str, Any]:
    value = parent.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{key} is not an object")
    return value


def _strings(value: Any) -> list[str]:
    """A string, or the strings of a list."""
    items = value if isinstance(value, list) else [value]
    return [item for item in items if isinstance(item, str) and item]


def _description(description: dict[str, Any]) -> list[tuple[str, str]]:
    comment = description.get("Comment")
    paragraphs = _strings(comment.get("Paragraph")) if isinstance(comment, dict) else []
    synonyms = description.get("Synonym")
    synonym_items = synonyms if isinstance(synonyms, list) else [synonyms]
    return [
        *(("Description", p) for p in paragraphs),
        *(("Sample name", n) for n in _strings(description.get("SampleName"))),
        *(
            ("Synonym", s["content"])
            for s in synonym_items
            if isinstance(s, dict) and isinstance(s.get("content"), str)
        ),
    ]


# Members that the record leaves out: the description and the attributes, which have their own place, and the contacts
# of the owner, which name people.
_NOT_IN_RECORD = {
    "Attributes",
    "Description.Title",
    "Description.Comment",
    "Description.SampleName",
    "Description.Synonym",
    "Owner.Contacts",
}


def _record(body: dict[str, Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    _leaves(body, "", out)
    return out


def _leaves(value: Any, path: str, out: list[tuple[str, str]]) -> None:
    """Every string under `value`, with its path. The `content` of an object is the value of the object's own path."""
    if path in _NOT_IN_RECORD:
        return
    if isinstance(value, dict):
        for key, item in value.items():
            child = path if key == "content" else f"{path}.{key}" if path else key
            if key == "content" and not isinstance(item, (dict, list)):
                _leaves(item, path, out)
            else:
                _leaves(item, child, out)
    elif isinstance(value, list):
        for item in value:
            _leaves(item, path, out)
    elif isinstance(value, str):
        if value and path:
            out.append((path, value))
    elif isinstance(value, (int, float)) and not isinstance(value, bool) and path:
        out.append((path, str(value)))


def _attributes(body: dict[str, Any]) -> list[Attribute]:
    holder = body.get("Attributes")
    raw = holder.get("Attribute") if isinstance(holder, dict) else None
    items = raw if isinstance(raw, list) else ([raw] if isinstance(raw, dict) else [])
    out: list[Attribute] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = item.get("attribute_name")
        content = item.get("content")
        value = str(content) if isinstance(content, (int, float)) and not isinstance(content, bool) else content
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
