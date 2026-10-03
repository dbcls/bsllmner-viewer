"""Lexer patterns mirrored from grammar.lark for code that emits DSL strings."""

from __future__ import annotations

import re
from typing import Final

WORD_RE: Final[re.Pattern[str]] = re.compile(r"^[^\s:()\[\]\"{}^~*?\/]+\Z")
DATE_RE: Final[re.Pattern[str]] = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")
WILDCARD_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_\-.]*[*?][A-Za-z0-9_\-.]*\Z")
RESERVED: Final[frozenset[str]] = frozenset({"AND", "OR", "NOT"})


def is_bare_word(value: str) -> bool:
    """True when the value can be written without quotes and is read back as the same word."""
    return WORD_RE.match(value) is not None and not needs_quote(value)


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
