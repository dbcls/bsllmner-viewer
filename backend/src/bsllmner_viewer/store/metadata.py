"""The original metadata of a BioSample, in the form that build traces evidence in and that the api returns."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Final, Literal, NamedTuple

import orjson

type EvidenceStrategy = Literal["exact", "case_insensitive", "normalized", "bag_of_words", "fuzzy", "ontology_synonym"]
type MetadataKind = Literal["description", "attribute", "record"]

DESCRIPTION: Final[MetadataKind] = "description"
RECORD: Final[MetadataKind] = "record"
ATTRIBUTE: Final[MetadataKind] = "attribute"


def description_items(title: str | None, description: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    """The items of the description as (name, value): the title, then the paragraphs, sample names, and synonyms.

    Evidence in the description identifies an item by its position in this list.
    """
    return [*([("Title", title)] if title else []), *description]


class StoredAttribute(NamedTuple):
    name: str
    value: str
    harmonized_name: str | None


def stored_description(title: str | None, raw_json: str) -> list[tuple[str, str]]:
    """The description items of a BioSample from the stored JSON of its description."""
    return description_items(title, ((str(d["name"]), str(d["value"])) for d in orjson.loads(raw_json)))


def stored_attributes(raw_json: str) -> list[StoredAttribute]:
    """The attributes of a BioSample from the stored JSON of its attributes."""
    return [StoredAttribute(str(a["name"]), str(a["value"]), a.get("harmonized_name")) for a in orjson.loads(raw_json)]
