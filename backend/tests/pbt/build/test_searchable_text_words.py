"""The searchable text and a keyword split a text into the same words.

A word is a run of letters, digits, and combining marks that has a letter or a digit, in any script. Every other
character separates words.
"""

from __future__ import annotations

import json
import unicodedata

import duckdb
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.build.derive import _derive_searchable_text
from bsllmner_viewer.dsl.keyword import parts

# Texts of ASCII only, of characters below 0x10000, and of any characters, so that each class of patterns is used.
_texts = st.one_of(
    st.text(st.characters(max_codepoint=0x7F), max_size=40),
    st.text(st.characters(max_codepoint=0xFFFF, blacklist_categories=["Cs"]), max_size=40),
    st.text(st.characters(blacklist_categories=["Cs"]), max_size=40),
)
_words_with_symbols = st.lists(
    st.one_of(
        st.text(st.characters(categories=["L", "Nd"], max_codepoint=0x7F), min_size=1, max_size=4),
        st.text(st.characters(categories=["L", "Nd"]), min_size=1, max_size=4),
    ),
    min_size=2,
    max_size=4,
).flatmap(
    lambda words: st.lists(
        st.sampled_from(["-", "+", ".", "/", "_", "(", "'", "\u2013"]), min_size=len(words) - 1, max_size=len(words) - 1
    ).map(lambda symbols: words[0] + "".join(s + w for s, w in zip(symbols, words[1:], strict=True)))
)


def _is_word_character(character: str) -> bool:
    category = unicodedata.category(character)
    return category[0] in ("L", "M") or category == "Nd"


def _is_letter_or_digit(character: str) -> bool:
    category = unicodedata.category(character)
    return category[0] == "L" or category == "Nd"


def _oracle_words(text: str) -> list[str]:
    runs: list[str] = []
    current = ""
    for character in unicodedata.normalize(
        "NFC", unicodedata.normalize("NFC", text).replace("\u0130", "i").lower().replace("\u03c2", "\u03c3")
    ):
        if _is_word_character(character):
            current += character
        elif current:
            runs.append(current)
            current = ""
    runs = [*runs, current] if current else runs
    return [run for run in runs if any(_is_letter_or_digit(c) for c in run)]


def _searchable_text_of_a_title(title: str) -> str:
    con = duckdb.connect(":memory:")
    try:
        con.execute(
            "CREATE TABLE biosample "
            "(accession VARCHAR, title VARCHAR, organism_name VARCHAR, description JSON, attributes JSON)"
        )
        con.execute(
            "CREATE TABLE annotation "
            "(biosample VARCHAR, field VARCHAR, value_index INTEGER, extracted_value VARCHAR, term_label VARCHAR)"
        )
        con.execute("CREATE TABLE population (biosample VARCHAR)")
        con.execute("INSERT INTO biosample VALUES ('S1', ?, NULL, ?, NULL)", [title, json.dumps([])])
        con.execute("INSERT INTO population VALUES ('S1')")
        _derive_searchable_text(con)
        row = con.execute("SELECT text FROM searchable_text").fetchone()
        assert row is not None
        return str(row[0])
    finally:
        con.close()


@settings(max_examples=500)
@given(_texts)
def test_keyword_parts_are_the_runs_of_letters_digits_and_combining_marks_that_have_a_letter_or_a_digit(
    text: str,
) -> None:
    assert parts(text) == _oracle_words(text)


@settings(max_examples=200)
@given(_texts)
def test_searchable_text_of_a_value_has_the_words_that_a_keyword_finds_in_it(text: str) -> None:
    searchable = _searchable_text_of_a_title(text)
    assert searchable.split(" | ")[0].split() == parts(text)


@settings(max_examples=200)
@given(_words_with_symbols)
def test_searchable_text_of_a_word_with_symbols_has_the_joined_form_that_a_keyword_looks_for(word: str) -> None:
    searchable = _searchable_text_of_a_title(word)
    joined = "".join(parts(word))
    assert f" {joined} " in " " + searchable.split(" | ", 1)[1]
