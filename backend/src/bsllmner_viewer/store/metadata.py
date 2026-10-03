"""The original metadata of a BioSample, in the form that build traces evidence in and that the api returns."""

from __future__ import annotations

from collections.abc import Iterable

DESCRIPTION = "description"
RECORD = "record"
ATTRIBUTE = "attribute"


def description_items(title: str | None, description: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    """The items of the description as (name, value): the title, then the paragraphs, sample names, and synonyms.

    Evidence in the description identifies an item by its position in this list.
    """
    return [*([("Title", title)] if title else []), *description]
