"""Lexer patterns mirrored from grammar.lark for code that emits DSL strings."""

from __future__ import annotations

import re
from typing import Final

# A single-quoted phrase as the grammar reads it: it closes at a `'` that a space, `)`, or the end follows.
_SINGLE_QUOTED: Final[str] = r"'(?:[^'\\]|\\.|'(?=[^\s)]))*'(?![^\s)])"
WORD_RE: Final[re.Pattern[str]] = re.compile(rf"^(?!{_SINGLE_QUOTED})[^\s:()\[\]\"{{}}^~*?\/]+\Z")
# A single-quoted phrase that starts at the start of a token of a text.
SINGLE_QUOTED_PHRASE_RE: Final[re.Pattern[str]] = re.compile(rf"(?<![^\s(]){_SINGLE_QUOTED}")
DATE_RE: Final[re.Pattern[str]] = re.compile(r"\d{4}-\d{2}-\d{2}")
WILDCARD_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_\-.]*[*?][A-Za-z0-9_\-.]*\Z")
_OPERATOR_QUOTE: Final[re.Pattern[str]] = re.compile(r"(?:AND|OR|NOT)'")
RESERVED: Final[frozenset[str]] = frozenset({"AND", "OR", "NOT"})


def is_bare_word(value: str) -> bool:
    """True when the value can be written without quotes and is read back as the same word."""
    return WORD_RE.match(value) is not None and not needs_quote(value)


def is_keyword_word(value: str) -> bool:
    """True when a word of a keyword can be written bare and is read back as the same word.

    A keyword position does not lex dates, so a word that starts like a date is fine. A word is not bare when it
    equals an operator, starts with an operator followed by `'`, or is a closed single-quoted phrase. The words of a
    keyword must also not form a single-quoted phrase together (`SINGLE_QUOTED_PHRASE_RE`).
    """
    return WORD_RE.match(value) is not None and value not in RESERVED and _OPERATOR_QUOTE.match(value) is None


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
        or _OPERATOR_QUOTE.match(value) is not None
        or WILDCARD_RE.match(value) is not None
    )
