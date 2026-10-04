"""Keywords: terms without a field, matched against the searchable text of BioSamples and against accessions.

A word is a run of letters, digits, and combining marks that has a letter or a digit, in any script, so `β-catenin`
has the words `β` and `catenin`. Every other character separates words. The searchable text (`searchable_text`,
which `build.derive` stores) is lower-cased, its words are separated by one space, its values by " | ", and it starts
and ends with a space. A word that joins its parts with symbols, such as "MCF-7", also appears with its parts written
together ("mcf7") after the values. Matching a whole word is then `LIKE '% word %'`, matching the start of a word
`LIKE '% word%'`, and a phrase `LIKE '% a b %'`. The keywords and the searchable text use the same functions, so they
split a text alike.
"""

from __future__ import annotations

import re
import sys
import unicodedata
from dataclasses import dataclass
from typing import Literal

from bsllmner_viewer.dsl.ast import FreeText, Node
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.lex import RESERVED, SINGLE_QUOTED_PHRASE_RE, is_keyword_word
from bsllmner_viewer.dsl.serializer import quote
from bsllmner_viewer.dsl.transform import conjuncts

type AccessionKind = Literal["biosample", "experiment", "run", "bioproject"]


def _ranges(marks: bool) -> list[tuple[int, int]]:
    """The ranges of the letters and the decimal digits, with the combining marks if `marks`."""
    ranges: list[tuple[int, int]] = []
    start: int | None = None
    for code in range(sys.maxunicode + 2):
        category = unicodedata.category(chr(code)) if code <= sys.maxunicode else "Cn"
        if category[0] == "L" or category == "Nd" or (marks and category[0] == "M"):
            if start is None:
                start = code
        elif start is not None:
            ranges.append((start, code - 1))
            start = None
    return ranges


@dataclass(frozen=True, slots=True)
class _Patterns:
    """The patterns of words for texts whose characters are all below a limit."""

    word: re.Pattern[str]
    joined: re.Pattern[str]


def _patterns(
    letters_and_digits: list[tuple[int, int]], word_characters: list[tuple[int, int]], limit: int
) -> _Patterns:
    def character_class(ranges: list[tuple[int, int]]) -> str:
        return "".join(f"\\U{low:08x}-\\U{min(high, limit - 1):08x}" for low, high in ranges if low < limit)

    letter_or_digit, word_character = character_class(letters_and_digits), character_class(word_characters)
    # A word: a run of letters, digits, and combining marks that has a letter or a digit. The run starts where no word
    # character comes before it, and the quantifiers are possessive, so that a match never backtracks into a run and
    # the time stays linear in the length of the text.
    core = f"(?:(?![{letter_or_digit}])[{word_character}])*+[{letter_or_digit}][{word_character}]*+"
    word = f"(?<![{word_character}]){core}"
    # Words joined by characters other than white space and the bar, such as "MCF-7" or "IL-4/IL-13".
    joined = f"{word}(?:[^{letter_or_digit}\\s|]+{core})+"
    return _Patterns(re.compile(word), re.compile(joined))


_LETTERS_AND_DIGITS = _ranges(marks=False)
_WORD_CHARACTERS = _ranges(marks=True)
# A class of characters below 0x10000 is a bitmap, and a larger class is a list that each character is compared with,
# so a text without the larger characters uses the smaller classes. Each class has the same characters below its limit.
_ASCII_PATTERNS = _patterns(_LETTERS_AND_DIGITS, _WORD_CHARACTERS, 0x80)
_BMP_PATTERNS = _patterns(_LETTERS_AND_DIGITS, _WORD_CHARACTERS, 0x10000)
_ALL_PATTERNS = _patterns(_LETTERS_AND_DIGITS, _WORD_CHARACTERS, sys.maxunicode + 1)
_SPACES = re.compile(" +")


def _patterns_for(text: str) -> _Patterns:
    if text.isascii():
        return _ASCII_PATTERNS
    if max(text) <= "\uffff":
        return _BMP_PATTERNS
    return _ALL_PATTERNS


_ACCESSIONS: tuple[tuple[re.Pattern[str], AccessionKind], ...] = (
    (re.compile(r"SAM(?:N|D|EA)[0-9]+"), "biosample"),
    (re.compile(r"[SDE]RX[0-9]+"), "experiment"),
    (re.compile(r"[SDE]RR[0-9]+"), "run"),
    (re.compile(r"PRJ(?:NA|DB|EB)[0-9]+"), "bioproject"),
)


def parts(text: str) -> list[str]:
    """The words of a text as the searchable text holds them: lower case, split at every other character."""
    lowered = _lower(text)
    return _patterns_for(lowered).word.findall(lowered)


def searchable_text(values: str) -> str:
    """The searchable text of values joined by "|", which no value contains.

    The words of each value are separated by one space, and the values by " | ". The joined form of each word with
    symbols follows the values, each joined form as a value of its own, so that a phrase spans neither two values nor
    two joined forms.
    """
    lowered = _lower(values)
    patterns = _patterns_for(lowered)
    words = " | ".join(" ".join(patterns.word.findall(value)) for value in lowered.split("|"))
    joined = " | ".join(_joined(patterns.word.findall(found)) for found in patterns.joined.findall(lowered))
    return _SPACES.sub(" ", f" {words} | {joined} ")


def _joined(words: list[str]) -> str:
    """The words written together, composed again, because a word can start with a combining mark."""
    return unicodedata.normalize("NFC", "".join(words))


def _lower(text: str) -> str:
    """Lower case in the composed form (NFC), so that a decomposed `é` is the same as a composed one.

    `İ` becomes `i`, where Python adds a combining dot (`i̇`) that no keyword would type. The final sigma (U+03C2),
    which Python writes at the end of a word, becomes the sigma (U+03C3). Letters are not folded further: `ß` stays
    `ß`, as in the lower case of a search engine.
    """
    if text.isascii():
        return text.lower()
    lowered = unicodedata.normalize("NFC", text).replace("\u0130", "i").lower().replace("\u03c2", "\u03c3")
    return unicodedata.normalize("NFC", lowered)


def accession_kind(word: str) -> AccessionKind | None:
    """The kind of accession that a word is, case-insensitively, or None. An accession is written in ASCII."""
    if not word.isascii():
        return None
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
            matches.append(TextMatch((f"% {' '.join(word_parts)} %", f"% {_joined(word_parts)} %")))
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
        if is_keyword_word(word):
            words.append(word)
        else:
            phrases.append(FreeText(value=word, is_phrase=True))
    # Words that would form a single-quoted phrase together, as in `'s y'`, each become a phrase of their own.
    if SINGLE_QUOTED_PHRASE_RE.search(" ".join(words)):
        phrases += [FreeText(value=w, is_phrase=True) for w in words if w.startswith("'")]
        words = [w for w in words if not w.startswith("'")]
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
