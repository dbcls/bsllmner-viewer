from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.api.term_sites import shown_synonyms

words = st.text(alphabet="abcABC xyz", min_size=1, max_size=6)


@given(st.one_of(st.none(), words), st.lists(words, max_size=8))
def test_shown_synonyms_differ_from_the_label_and_from_each_other_beyond_letter_case(
    label: str | None, synonyms: list[str]
) -> None:
    shown = shown_synonyms(label, synonyms)
    folded = [s.casefold() for s in shown]
    assert len(set(folded)) == len(folded)
    assert label is None or label.casefold() not in folded
    assert set(shown) <= set(synonyms)
    expected = {s.casefold() for s in synonyms} - ({label.casefold()} if label else set())
    assert set(folded) == expected


def test_shown_synonyms_drop_the_label_in_other_cases_and_keep_one_of_each_case_variant() -> None:
    assert shown_synonyms("Dimethyl sulfoxide", ["DIMETHYL SULFOXIDE", "DMSO", "dmso", "dimethyl sulfoxide"]) == [
        "DMSO"
    ]
