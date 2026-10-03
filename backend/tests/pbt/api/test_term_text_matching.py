import duckdb
from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.api.queries.terms import like_pattern

_FOLDING = "aAbB0_%\\ -\u00df\u1e9e\u00b5\u039c\u03c2\u03a3\u03c3\ufb01\u0130I\u0131Kk"
_ALPHABET = st.sampled_from(list(_FOLDING)) | st.characters(max_codepoint=0x2FFF)


@given(st.text(_ALPHABET, max_size=12))
def test_term_text_search_stored_text_matches_its_own_substring_pattern_and_exact_value(s: str) -> None:
    con = duckdb.connect()
    row = con.execute(
        "SELECT lower(?) LIKE lower(?) ESCAPE '\\', lower(?) = lower(?)", [s, like_pattern(s), s, s]
    ).fetchone()
    assert row is not None
    contains, equals = row
    assert contains
    assert equals


def test_like_pattern_wildcards_and_escape_character_are_escaped_and_case_is_kept() -> None:
    assert like_pattern("50%_A\\") == "%50\\%\\_A\\\\%"
