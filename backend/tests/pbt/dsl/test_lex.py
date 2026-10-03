from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import FieldClause
from bsllmner_viewer.dsl.lex import is_bare_word
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serializer import quote, serialize

_values = st.text(st.characters(blacklist_categories=["Cs"], max_codepoint=0x24F), min_size=1, max_size=10)


@given(_values)
def test_a_bare_word_is_read_back_as_the_same_word_and_any_other_value_as_a_phrase_when_quoted(value: str) -> None:
    text = value if is_bare_word(value) else quote(value)
    node = parse(f"title:{text}")
    assert isinstance(node, FieldClause)
    assert node.value == value
    assert (node.value_kind == "word") == is_bare_word(value)


@pytest.mark.parametrize(
    "value",
    ["2024-01-01x", "2024-01-01-extra", "1234-56-78abc", "\uff12\uff10\uff12\uff14-\uff10\uff11-\uff10\uff11"],
)
def test_a_value_that_starts_like_a_date_is_quoted_and_read_back_as_the_same_value(value: str) -> None:
    assert not is_bare_word(value)
    node = parse(serialize(FieldClause("disease", "word", value)))
    assert isinstance(node, FieldClause)
    assert node.value == value
