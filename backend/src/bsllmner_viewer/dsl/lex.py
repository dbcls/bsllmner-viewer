"""Lexer patterns mirrored from grammar.lark for code that emits DSL strings."""

from __future__ import annotations

import re
from typing import Final

WORD_RE: Final[re.Pattern[str]] = re.compile(r"^[^\s:()\[\]\"{}^~*?\/]+$")
DATE_RE: Final[re.Pattern[str]] = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WILDCARD_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_\-.]*[*?][A-Za-z0-9_\-.]*$")
RESERVED: Final[frozenset[str]] = frozenset({"AND", "OR", "NOT"})


def needs_quote(value: str) -> bool:
    """True when a bare value would be lexed as a higher-priority token (date, operator, wildcard, phrase).

    A value that starts with `'` opens a single-quoted phrase, which runs to the next `'` anywhere after it, across
    spaces and clauses. A `'` inside a value, as in `5'-UTR`, is part of the word, because a token starts only at its
    first character.
    """
    return (
        value.startswith("'")
        or DATE_RE.match(value) is not None
        or value in RESERVED
        or WILDCARD_RE.match(value) is not None
    )
