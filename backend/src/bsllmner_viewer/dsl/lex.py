"""Lexer patterns mirrored from grammar.lark for code that emits DSL strings."""

from __future__ import annotations

import re
from typing import Final

WORD_RE: Final[re.Pattern[str]] = re.compile(r"^[^\s:()\[\]\"{}^~*?\/]+$")
DATE_RE: Final[re.Pattern[str]] = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WILDCARD_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_\-.]*[*?][A-Za-z0-9_\-.]*$")
RESERVED: Final[frozenset[str]] = frozenset({"AND", "OR", "NOT"})


def needs_quote(value: str) -> bool:
    """True when a bare value would be lexed as a higher-priority token (date, operator, wildcard)."""
    return DATE_RE.match(value) is not None or value in RESERVED or WILDCARD_RE.match(value) is not None
