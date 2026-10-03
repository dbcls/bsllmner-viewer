"""Keywords: terms without a field, matched against the searchable text of BioSamples and against accessions.

The searchable text (built by `build.derive`) is lower-cased, every run of characters other than ASCII letters and
digits is one space, the values are joined by " | ", and the text starts and ends with a space. A word that joins its
parts with symbols, such as "MCF-7", also appears with its parts written together ("mcf7") after the value. Matching a
whole word is then `LIKE '% word %'`, matching the start of a word `LIKE '% word%'`, and a phrase `LIKE '% a b %'`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from bsllmner_viewer.dsl.ast import FreeText, Node
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.lex import RESERVED, is_keyword_word
from bsllmner_viewer.dsl.serializer import quote
from bsllmner_viewer.dsl.transform import conjuncts

type AccessionKind = Literal["biosample", "experiment", "run", "bioproject"]

_SEPARATOR = re.compile(r"[^0-9a-z]+")
_ACCESSIONS: tuple[tuple[re.Pattern[str], AccessionKind], ...] = (
    (re.compile(r"SAM(?:N|D|EA)[0-9]+"), "biosample"),
    (re.compile(r"[SDE]RX[0-9]+"), "experiment"),
    (re.compile(r"[SDE]RR[0-9]+"), "run"),
    (re.compile(r"PRJ(?:NA|DB|EB)[0-9]+"), "bioproject"),
)


def parts(text: str) -> list[str]:
    """The words of a text as the searchable text holds them: lower case, split at every other character."""
    return [part for part in _SEPARATOR.split(_lower(text)) if part]


def _lower(text: str) -> str:
    """Lower case as DuckDB's `lower` does, which maps `İ` to `i` where Python adds a combining dot."""
    return text.replace("\u0130", "i").lower()


def accession_kind(word: str) -> AccessionKind | None:
    """The kind of accession that a word is, case-insensitively, or None."""
    upper = word.upper()
    for pattern, kind in _ACCESSIONS:
        if pattern.fullmatch(upper):
            return kind
    return None


@dataclass(frozen=True, slots=True)
class Accession:
    kind: AccessionKind
    accession: str


@dataclass(frozen=True, slots=True)
class TextMatch:
    """`LIKE` patterns of which at least one must match the searchable text."""

    patterns: tuple[str, ...]


type WordMatch = Accession | TextMatch


def word_matches(keyword: FreeText) -> list[WordMatch]:
    """What each word of a keyword requires. All of them must hold. Empty when the keyword has no letter or digit."""
    if keyword.is_phrase:
        words = parts(keyword.value)
        return [TextMatch((f"% {' '.join(words)} %",))] if words else []
    raw_words = keyword.value.split()
    matches: list[WordMatch] = []
    last_index = max((i for i, raw in enumerate(raw_words) if parts(raw)), default=-1)
    for index, raw in enumerate(raw_words):
        kind = accession_kind(raw)
        if kind is not None:
            matches.append(Accession(kind, raw.upper()))
            continue
        word_parts = parts(raw)
        if not word_parts:
            continue
        if len(word_parts) > 1:
            matches.append(TextMatch((f"% {' '.join(word_parts)} %", f"% {''.join(word_parts)} %")))
            continue
        word = word_parts[0]
        last = index == last_index
        has_symbol = _lower(raw) != word
        prefix = last and not has_symbol and len(word) > 1
        matches.append(TextMatch((f"% {word}%" if prefix else f"% {word} %",)))
    return matches


# A phrase in double quotes; a phrase from a `'` that starts a word to a `'` that ends a word, which may hold a `'`
# inside a word (`'Alzheimer's disease'`); or a word.
_TYPED = re.compile(r'"((?:[^"\\]|\\.)*)"|(?<!\S)\'((?:[^\'\\]|\\.|\'(?=\S))*)\'(?!\S)|(\S+)')
_ESCAPE = re.compile(r"\\(.)")


def typed_keywords(text: str) -> list[FreeText]:
    """The keywords of text typed into a keyword box, as a search engine reads it.

    Quoted parts are phrases, and the other words form one keyword, so `breast "cell line" cancer` is the keyword
    `breast cancer` and the phrase `"cell line"`. A part is quoted by double quotes, or by a `'` at the start of a word
    and a `'` at the end of a word, as in `'cell line'`. A `'` inside a word or only at its end, as in `Alzheimer's`,
    `5'-UTR`, or `3'`, is part of the word. A word that the condition DSL cannot write bare, such as `HIF-1/2` or `'s`,
    becomes a phrase of its own, which matches its parts in sequence like any word with symbols. `AND`, `OR`, and `NOT`
    are ordinary words here. Wildcards are rejected, and parts without a letter or a digit are dropped.
    """
    words: list[str] = []
    phrases: list[FreeText] = []
    for match in _TYPED.finditer(text):
        quoted = match.group(1) if match.group(1) is not None else match.group(2)
        word = match.group(3)
        if quoted is not None:
            phrases.append(FreeText(value=" ".join(_ESCAPE.sub(r"\1", quoted).split()), is_phrase=True))
            continue
        if "*" in word or "?" in word:
            raise DslError(type=ErrorType.unexpected_token, detail=f"wildcards are not accepted in keywords: {word!r}")
        if word in RESERVED:
            word = word.lower()
        if is_keyword_word(word, first=not words):
            words.append(word)
        else:
            phrases.append(FreeText(value=word, is_phrase=True))
    keywords = ([FreeText(value=" ".join(words))] if words else []) + phrases
    return [keyword for keyword in keywords if word_matches(keyword)]


def keyword_text(ast: Node | None) -> str:
    """The text of a keyword box for the top-level keywords of a condition: the inverse of `typed_keywords`.

    The words come first, as written, and the phrases follow, each in double quotes with `\\` and `"` escaped.
    """
    keywords = [c for c in conjuncts(ast) if isinstance(c, FreeText)]
    words = [k.value for k in keywords if not k.is_phrase]
    phrases = [quote(k.value) for k in keywords if k.is_phrase]
    return " ".join([*words, *phrases])
