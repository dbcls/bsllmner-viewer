"""Provenance tracing: where an extracted value occurs in the original metadata of its BioSample.

The strategies are tried in order, and each accepts more variation than the strategy before it. A value is traced
with the first strategy that matches, so a weaker match is never shown next to a stronger one.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

EXACT = "exact"
CASE_INSENSITIVE = "case_insensitive"
NORMALIZED = "normalized"
BAG_OF_WORDS = "bag_of_words"
FUZZY = "fuzzy"
ONTOLOGY_SYNONYM = "ontology_synonym"
TEXT_STRATEGIES = (EXACT, CASE_INSENSITIVE, NORMALIZED, BAG_OF_WORDS, FUZZY)
"""The strategies that search for the text of the value itself, in order."""

SHORT_VALUE = 3
"""A value of fewer characters is searched only with `exact`: `NO` (nitric oxide) is also the word "No"."""
SHORT_TERM_NAME = 5
"""A name of a term of fewer characters is searched only with `exact`, for the same reason as `SHORT_VALUE`."""
_NORMALIZED_MIN = 3
"""A normalized form of fewer characters does not match: separators and brackets carry much of a short value."""

# A word, with a `+` or `-` sign right after it (CD19+ and CD19- are different words). A `+` or `-` between two words
# joins them and is not a sign (Long-Lived, GM+CSF).
_WORD = re.compile(r"[^\W_]+(?:[+-](?![^\W_]))*")
_DIGITS = re.compile(r"\d+")
_POINT_MUTATION = re.compile(r"[A-Z][0-9]{1,4}[A-Z]")
# Genotype and construct names attach these to a gene without a separator, as in Whsc1KO and shBRD9.
_SUFFIXES = frozenset(
    {"KO", "ko", "CKO", "cKO", "fl", "f", "flox", "LSL", "GFP", "eGFP", "OE", "KD", "wt", "Cre", "IRES", "lox", "delta",
     "del", "s"}
)  # fmt: skip
_PREFIXES = frozenset({"sh", "si", "sg", "TRE", "peg"})
_OPEN = "([{"
_CLOSE = ")]}"
_CONFUSABLE = {"l": "1", "i": "1", "1": "1", "o": "0", "0": "0"}
"""Characters that look alike, by group, after folding."""


@dataclass(frozen=True, slots=True)
class Span:
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class Match:
    text: int
    """Position of the text in the texts that were searched."""
    span: Span


@dataclass(frozen=True, slots=True)
class Traced:
    strategy: str
    group: int
    """Position of the group of texts in which the value matched."""
    matches: list[Match]


@dataclass(frozen=True, slots=True)
class _Word:
    folded: str
    start: int
    end: int


def _fold_char(ch: str) -> str:
    return unicodedata.normalize("NFKC", ch).casefold()


class Text:
    """A text to search, or a value to search for, with the forms that the strategies compare.

    Each form is computed when a strategy first needs it, so a text in which every value matches `exact` is never
    folded.
    """

    __slots__ = ("_folded", "_normalized", "_origin", "_words", "raw")

    def __init__(self, raw: str) -> None:
        self.raw = raw
        self._folded: str | None = None
        self._origin: list[int] = []
        self._normalized: dict[int, tuple[str, list[int]]] = {}
        self._words: list[_Word] | None = None

    def folded(self) -> tuple[str, list[int]]:
        """The folded text, and for each of its characters the position of the character it came from."""
        if self._folded is None:
            if self.raw.isascii():
                self._folded, self._origin = self.raw.lower(), list(range(len(self.raw)))
            else:
                chars: list[str] = []
                for index, ch in enumerate(self.raw):
                    for folded in _fold_char(ch):
                        chars.append(folded)
                        self._origin.append(index)
                self._folded = "".join(chars)
        return self._folded, self._origin

    def normalized(self, form: int) -> tuple[str, list[int]]:
        """A normalized form of the folded text (1, 2, or 3), with the position of each character in the raw text."""
        if form not in self._normalized:
            folded, origin = self.folded()
            self._normalized[form] = _normalize(folded, origin, strip=form == 2, keep_brackets=form == 3)
        return self._normalized[form]

    def words(self) -> list[_Word]:
        if self._words is None:
            self._words = [
                _Word("".join(_fold_char(ch) for ch in m.group()), m.start(), m.end()) for m in _WORD.finditer(self.raw)
            ]
        return self._words


def _normalize(chars: str, origin: list[int], *, strip: bool, keep_brackets: bool) -> tuple[str, list[int]]:
    """Separators become one space (or nothing, with `strip`). Brackets go with their content, or alone."""
    out: list[str] = []
    out_origin: list[int] = []
    after_space = True
    i, n = 0, len(chars)
    while i < n:
        ch = chars[i]
        if ch in _OPEN and not keep_brackets:
            depth = 1
            i += 1
            while i < n and depth:
                if chars[i] in _OPEN:
                    depth += 1
                elif chars[i] in _CLOSE:
                    depth -= 1
                i += 1
            continue
        if ch.isspace() or ch in "-_" or (keep_brackets and (ch in _OPEN or ch in _CLOSE)):
            if not strip and not after_space:
                out.append(" ")
                out_origin.append(origin[i])
                after_space = True
            i += 1
            continue
        out.append(ch)
        out_origin.append(origin[i])
        after_space = False
        i += 1
    while out and out[-1] == " ":
        out.pop()
        out_origin.pop()
    return "".join(out), out_origin


def _run_before(raw: str, start: int) -> str:
    i = start
    while i > 0 and raw[i - 1].isalnum():
        i -= 1
    return raw[i:start]


def _run_after(raw: str, end: int) -> str:
    i = end
    while i < len(raw) and raw[i].isalnum():
        i += 1
    return raw[end:i]


def _at_boundaries(raw: str, start: int, end: int, *, affixes: bool = False) -> bool:
    """Whether the span does not cut a run of letters and digits.

    With `affixes`, the span may cut a run at a known affix, or where a lowercase letter meets an uppercase letter, as
    names of genotypes join a gene to its neighbors (`CreNeurod1`, `pSTAT3`, `LynBKO`). A digit that meets an uppercase
    letter is not such a place: TP53 and TP53BP1 are different genes.
    """
    if raw[start].isalnum() and start > 0 and raw[start - 1].isalnum():
        camel = raw[start - 1].islower() and raw[start].isupper()
        if not (affixes and (camel or _run_before(raw, start) in _PREFIXES)):
            return False
    if raw[end - 1].isalnum() and end < len(raw) and raw[end].isalnum():
        camel = raw[end - 1].islower() and raw[end].isupper()
        run = _run_after(raw, end)
        if not (affixes and (camel or run in _SUFFIXES or _POINT_MUTATION.fullmatch(run))):
            return False
    return True


def _balanced(raw: str, start: int, end: int) -> Span:
    """The span, widened over a bracket next to it that closes or opens a bracket inside it."""
    inside = raw[start:end]
    opened = sum(inside.count(ch) for ch in _OPEN)
    closed = sum(inside.count(ch) for ch in _CLOSE)
    while opened > closed and end < len(raw) and raw[end] in _CLOSE:
        end += 1
        closed += 1
    while closed > opened and start > 0 and raw[start - 1] in _OPEN:
        start -= 1
        opened += 1
    return Span(start, end)


def _starts(hay: str, needle: str) -> list[int]:
    """Every position at which the needle starts, overlapping or not."""
    found: list[int] = []
    at = hay.find(needle)
    while at >= 0:
        found.append(at)
        at = hay.find(needle, at + 1)
    return found


def _without_overlaps(spans: list[Span]) -> list[Span]:
    """The spans in order, each one left out if it overlaps an earlier one; of two that start together, the longer."""
    kept: list[Span] = []
    for span in sorted(spans, key=lambda s: (s.start, -s.end)):
        if not kept or span.start >= kept[-1].end:
            kept.append(span)
    return kept


def _exact(query: Text, text: Text) -> list[Span]:
    raw, needle = text.raw, query.raw
    spans: list[Span] = []
    for at in _starts(raw, needle):
        span = Span(at, at + len(needle))
        if (not spans or span.start >= spans[-1].end) and _at_boundaries(raw, span.start, span.end):
            spans.append(span)
    return spans


def _case_insensitive(query: Text, text: Text) -> list[Span]:
    needle, _ = query.folded()
    hay, origin = text.folded()
    spans: list[Span] = []
    for at in _starts(hay, needle):
        end = at + len(needle)
        # A match must begin and end with whole characters of the raw text, not inside the folding of one.
        if (at > 0 and origin[at - 1] == origin[at]) or (end < len(hay) and origin[end] == origin[end - 1]):
            continue
        span = Span(origin[at], origin[end - 1] + 1)
        if (not spans or span.start >= spans[-1].end) and _at_boundaries(text.raw, span.start, span.end):
            spans.append(span)
    return spans


def _normalized(query: Text, text: Text) -> list[Span]:
    spans: list[Span] = []
    for form in (1, 2, 3):
        needle, _ = query.normalized(form)
        if len(needle) < _NORMALIZED_MIN:
            continue
        hay, origin = text.normalized(form)
        for at in _starts(hay, needle):
            start, end = origin[at], origin[at + len(needle) - 1] + 1
            if _at_boundaries(text.raw, start, end, affixes=True):
                spans.append(_balanced(text.raw, start, end))
    return _without_overlaps(spans)


def _bag_of_words(query: Text, text: Text) -> list[Span]:
    wanted = [w.folded for w in query.words()]
    n = len(wanted)
    if n < 2:
        return []
    words = text.words()
    if not set(wanted) <= {w.folded for w in words}:
        return []
    key = sorted(wanted)
    spans: list[Span] = []
    i = 0
    while i + n <= len(words):
        window = words[i : i + n]
        if sorted(w.folded for w in window) == key:
            spans.append(Span(window[0].start, window[-1].end))
            i += n
        else:
            i += 1
    return spans


def _levenshtein_within(a: str, b: str, limit: int) -> bool:
    """Whether the Levenshtein distance between the words is at most `limit`."""
    if abs(len(a) - len(b)) > limit:
        return False
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        if min(current) > limit:
            return False
        previous = current
    return previous[-1] <= limit


def similar(a: str, b: str) -> bool:
    """Whether two folded words count as the same word with a spelling error, by the rules of `fuzzy`."""
    if a == b:
        return True
    if len(a) == len(b):
        differ = [(x, y) for x, y in zip(a, b, strict=True) if x != y]
        if len(differ) == 1:
            x, y = differ[0]
            if x in _CONFUSABLE and _CONFUSABLE[x] == _CONFUSABLE.get(y):
                return True
    shorter = min(len(a), len(b))
    if shorter < 6:
        return False
    digits_a, digits_b = _DIGITS.findall(a), _DIGITS.findall(b)
    if digits_a or digits_b:
        # Identifiers that differ only in their digits often name different things, such as ADAMTS13 and ADAMTS12.
        if digits_a != digits_b:
            return False
        limit = 1
    else:
        limit = 1 if shorter < 8 else 2 if shorter < 14 else 3
    return _levenshtein_within(a, b, limit)


def _fuzzy(query: Text, text: Text) -> list[Span]:
    wanted = [w.folded for w in query.words()]
    n = len(wanted)
    words = text.words()
    spans: list[Span] = []
    i = 0
    while n and i + n <= len(words):
        window = words[i : i + n]
        if all(similar(w.folded, x) for w, x in zip(window, wanted, strict=True)) and any(
            w.folded != x for w, x in zip(window, wanted, strict=True)
        ):
            spans.append(Span(window[0].start, window[-1].end))
            i += n
        else:
            i += 1
    return spans


_FIND = {
    EXACT: _exact,
    CASE_INSENSITIVE: _case_insensitive,
    NORMALIZED: _normalized,
    BAG_OF_WORDS: _bag_of_words,
    FUZZY: _fuzzy,
}


def find(strategy: str, query: Text, text: Text) -> list[Span]:
    """The spans of the text that match the query with one strategy, in order and without overlaps."""
    if not query.raw:
        return []
    return _FIND[strategy](query, text)


def trace(value: str, groups: Sequence[Sequence[Text]]) -> Traced | None:
    """The evidence of a value: the matches of the first strategy, and in it the first group, that has any."""
    query = Text(value.strip())
    strategies = TEXT_STRATEGIES if len(query.raw) >= SHORT_VALUE else (EXACT,)
    for strategy in strategies:
        for index, texts in enumerate(groups):
            matches = [Match(at, span) for at, text in enumerate(texts) for span in find(strategy, query, text)]
            if matches:
                return Traced(strategy, index, matches)
    return None


def trace_term(names: Sequence[str], groups: Sequence[Sequence[Text]]) -> Traced | None:
    """The evidence of a value through the names of its term (`ontology_synonym`), in the order of `trace`.

    For each strategy and group, every name is tried before the next, so an `exact` match of a synonym wins over a
    `fuzzy` match of the label. The matches of all names with the first strategy and group that match are kept.
    """
    queries = [Text(name) for name in dict.fromkeys(names) if name]
    for strategy in TEXT_STRATEGIES:
        named = [q for q in queries if strategy == EXACT or len(q.raw) >= SHORT_TERM_NAME]
        for index, texts in enumerate(groups):
            found: dict[int, list[Span]] = {}
            for query in named:
                for at, text in enumerate(texts):
                    spans = find(strategy, query, text)
                    if spans:
                        found.setdefault(at, []).extend(spans)
            if found:
                matches = [Match(at, span) for at in sorted(found) for span in _without_overlaps(found[at])]
                return Traced(ONTOLOGY_SYNONYM, index, matches)
    return None
