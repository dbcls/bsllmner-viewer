from __future__ import annotations

import unicodedata

from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.api.queries.evidence import MIN_EVIDENCE_LENGTH, find_spans

letters = st.text(alphabet="abcdefXYZ019", min_size=1, max_size=8)
separators = st.text(alphabet=" -_/.", max_size=2)


def _folded(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c not in " -_/.\t\n")


@given(letters, letters, letters)
def test_find_spans_finds_a_value_of_at_least_three_folded_characters_wherever_it_is(
    before: str, value: str, after: str
) -> None:
    text = f"{before} {value} {after}"
    spans = find_spans(text, value)
    if len(_folded(value)) < MIN_EVIDENCE_LENGTH:
        assert spans == []
    else:
        assert spans
        assert all(_folded(text[s.start : s.end]) == _folded(value) for s in spans)


@given(st.text(alphabet="abcXYZ19", min_size=1, max_size=2), separators, st.text(alphabet="abc XYZ-19", max_size=20))
def test_find_spans_never_matches_a_value_shorter_than_three_folded_characters(
    value: str, separator: str, text: str
) -> None:
    assert find_spans(f"{text} {value} {text}", f"{separator}{value}{separator}") == []


def test_find_spans_counts_characters_after_folding_at_the_boundary() -> None:
    assert MIN_EVIDENCE_LENGTH == 3
    assert find_spans("cells of CD4 donors", "CD") == []
    assert find_spans("cells of CD4 donors", "CD4") != []
    assert find_spans("https://example.org", "S") == []
    assert find_spans("M-7 and MCF-7", "M-7") == []
    assert find_spans("M-7 and MCF-7", "MCF7") != []
    full_width = "\uff2d\uff23\uff26\uff17"  # MCF7 in full-width letters, which NFKC folds to ASCII
    assert find_spans(f"{full_width} cells", "MCF7") != []
