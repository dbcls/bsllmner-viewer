from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import FieldClause
from bsllmner_viewer.dsl.lex import is_bare_word
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serializer import quote

_values = st.text(st.characters(blacklist_categories=["Cs"], max_codepoint=0x24F), min_size=1, max_size=10)


@given(_values)
def test_a_bare_word_is_read_back_as_the_same_word_and_any_other_value_as_a_phrase_when_quoted(value: str) -> None:
    text = value if is_bare_word(value) else quote(value)
    node = parse(f"title:{text}")
    assert isinstance(node, FieldClause)
    assert node.value == value
    assert (node.value_kind == "word") == is_bare_word(value)
