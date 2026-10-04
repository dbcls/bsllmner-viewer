import duckdb
from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.api.queries.terms import like_pattern

_FOLDING = "aAbB0_%\\ -\u00df\u1e9e\u00b5\u039c\u03c2\u03a3\u03c3\ufb01\u0130I\u0131Kk"
_ALPHABET = st.sampled_from(list(_FOLDING)) | st.characters(max_codepoint=0x2FFF)
_TEXT = st.text(_ALPHABET, max_size=12) | st.text(st.sampled_from(list("aA%_\\")), max_size=5)


@given(_TEXT, _TEXT, _TEXT)
def test_term_text_search_like_pattern_matches_exactly_the_texts_that_contain_the_query(
    s: str, before: str, after: str
) -> None:
    con = duckdb.connect()
    for t in (before + after, before + s + after):
        row = con.execute(
            "SELECT lower(?) LIKE lower(?) ESCAPE '\\', contains(lower(?), lower(?))",
            [t, like_pattern(s), t, s],
        ).fetchone()
        assert row is not None
        matches, contains = row
        assert matches == contains, (s, t)


def test_like_pattern_wildcards_and_escape_character_are_escaped_and_case_is_kept() -> None:
    assert like_pattern("50%_A\\") == "%50\\%\\_A\\\\%"
