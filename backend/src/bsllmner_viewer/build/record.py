"""The items of the record of an entry that build keeps: those in which an extracted value of the entry occurs."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

from bsllmner_viewer.api.queries.evidence import MIN_EVIDENCE_LENGTH, find_spans

_SEPARATORS = re.compile(r"[\s\-_/.]+")
# Joins the values of the items, so that a value cannot be found across two items.
_BETWEEN_ITEMS = "\x00"


def _fold(text: str) -> str:
    return _SEPARATORS.sub("", unicodedata.normalize("NFKC", text).casefold())


def evidenced_record(record: list[tuple[str, str]], extracted_values: Iterable[str]) -> list[tuple[str, str]]:
    """The items of the record in which an extracted value occurs, by the rule that evidence uses.

    Most entries have no extracted value anywhere in the record, so the whole record is checked once, quickly, before
    each item is checked by the rule itself.
    """
    values = [v for v in extracted_values if v]
    if not record or not values:
        return []
    whole = _fold(_BETWEEN_ITEMS.join(value for _, value in record))
    if not any(len(folded := _fold(v)) >= MIN_EVIDENCE_LENGTH and folded in whole for v in values):
        return []
    return [(path, value) for path, value in record if any(find_spans(value, v) for v in values)]
