"""A condition has at most a fixed number of keywords and of words.

A repeated word compiles to the same SQL as the word written once.
"""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.dsl.ast import FreeText
from bsllmner_viewer.dsl.compile import compile_condition
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.validator import MAX_KEYWORD_WORDS, MAX_KEYWORDS, validate

FIELDS = FieldSet(("disease",))
_WORDS = st.sampled_from(["alpha", "beta", "gamma", "delta", "il4", "k562"])


def _q(keywords: list[list[str]], joiner: str) -> str:
    return joiner.join(f'"{" ".join(words)}"' if len(words) > 1 else words[0] for words in keywords)


@given(st.integers(min_value=1, max_value=MAX_KEYWORDS + 8), st.sampled_from([" OR ", " AND "]))
def test_validate_accepts_up_to_the_keyword_limit_and_rejects_more(count: int, joiner: str) -> None:
    q = _q([[f"w{i}"] for i in range(count)], joiner)
    if count <= MAX_KEYWORDS:
        validate(parse(q), FIELDS)
        return
    with pytest.raises(DslError) as caught:
        validate(parse(q), FIELDS)
    assert caught.value.type is ErrorType.invalid_value
    assert f"at most {MAX_KEYWORDS} keywords" in caught.value.detail


@given(st.integers(min_value=1, max_value=MAX_KEYWORDS), st.integers(min_value=1, max_value=12))
def test_validate_counts_the_words_of_every_keyword(keywords: int, words: int) -> None:
    q = " OR ".join('"' + " ".join(f"w{k}x{w}" for w in range(words)) + '"' for k in range(keywords))
    # A phrase is one word.
    validate(parse(q), FIELDS)
    plain = " AND ".join(" ".join(f"w{k}x{w}" for w in range(words)) for k in range(keywords))
    total = keywords * words
    if total <= MAX_KEYWORD_WORDS:
        validate(parse(plain), FIELDS)
        return
    with pytest.raises(DslError) as caught:
        validate(parse(plain), FIELDS)
    assert caught.value.type is ErrorType.invalid_value
    assert f"at most {MAX_KEYWORD_WORDS} words" in caught.value.detail


def test_validate_accepts_a_keyword_at_the_word_limit_and_rejects_one_more_word() -> None:
    validate(parse(" ".join(f"w{i}" for i in range(MAX_KEYWORD_WORDS))), FIELDS)
    with pytest.raises(DslError):
        validate(parse(" ".join(f"w{i}" for i in range(MAX_KEYWORD_WORDS + 1))), FIELDS)


@given(st.sampled_from([" OR ", " AND "]), st.sampled_from(["", 'disease:"MONDO:1" AND ']))
def test_validate_reports_the_column_of_the_keyword_over_the_keyword_limit(joiner: str, prefix: str) -> None:
    keywords = [f"w{i}" for i in range(MAX_KEYWORDS + 1)]
    q = prefix + joiner.join(keywords)
    expected = len(prefix) + len(joiner.join(keywords[:MAX_KEYWORDS])) + len(joiner) + 1
    with pytest.raises(DslError) as caught:
        validate(parse(q), FIELDS)
    assert caught.value.column == expected


@given(st.sampled_from(["", 'disease:"MONDO:1" AND ', "NOT "]))
def test_validate_reports_the_column_of_the_keyword_over_the_word_limit(prefix: str) -> None:
    q = prefix + " ".join(f"w{i}" for i in range(MAX_KEYWORD_WORDS + 1))
    with pytest.raises(DslError) as caught:
        validate(parse(q), FIELDS)
    assert caught.value.column == len(prefix) + 1


def test_the_keyword_limits_do_not_count_clauses_of_a_field() -> None:
    q = " OR ".join(f'disease:"MONDO:{i}"' for i in range(MAX_KEYWORDS + 20))
    validate(parse(q), FIELDS)


@given(st.lists(_WORDS, min_size=1, max_size=12))
def test_a_repeated_word_compiles_as_the_word_once(words: list[str]) -> None:
    # The last word of a keyword also matches the start of a word, so it is never the same match as an earlier word.
    last = "zeta"
    once = list(dict.fromkeys(words))
    repeated = compile_condition(FreeText(" ".join([*words, last]), False), FIELDS)
    single = compile_condition(FreeText(" ".join([*once, last]), False), FIELDS)
    assert repeated.sql == single.sql
    assert repeated.params == single.params
