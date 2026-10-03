"""Evidence: where an extracted value occurs in the original attributes."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_SEPARATORS = re.compile(r"[\s\-_/.]+")
STRING_MATCH = "string_match"
# An extracted value shorter than this, counted in the characters that matching compares, has no evidence: a value
# such as `S` or `CD` occurs in unrelated text, such as `https`.
MIN_EVIDENCE_LENGTH = 3


@dataclass(frozen=True, slots=True)
class Span:
    start: int
    end: int


def _normalize_char(ch: str) -> str:
    return unicodedata.normalize("NFKC", ch).casefold()


def _fold(text: str) -> tuple[str, list[int]]:
    """Normalized text without separators, with a map from each normalized char to its source index."""
    out: list[str] = []
    origin: list[int] = []
    for index, ch in enumerate(text):
        if _SEPARATORS.fullmatch(ch):
            continue
        for folded in _normalize_char(ch):
            if _SEPARATORS.fullmatch(folded):
                continue
            out.append(folded)
            origin.append(index)
    return "".join(out), origin


def find_spans(attribute_value: str, extracted_value: str) -> list[Span]:
    """Character ranges of the extracted value inside the attribute value.

    Matching ignores case, applies NFKC normalization, and treats whitespace, hyphens, underscores, slashes,
    and periods as separators that may be present or absent on either side. A value of fewer than
    `MIN_EVIDENCE_LENGTH` compared characters is not matched.
    """
    needle, _ = _fold(extracted_value)
    if len(needle) < MIN_EVIDENCE_LENGTH:
        return []
    hay, origin = _fold(attribute_value)
    spans: list[Span] = []
    start = 0
    while True:
        at = hay.find(needle, start)
        if at < 0:
            break
        first = origin[at]
        last = origin[at + len(needle) - 1]
        span = Span(first, last + 1)
        if not spans or span.start >= spans[-1].end:
            spans.append(span)
        start = at + len(needle)
    return spans
