from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.dsl.canonical import ORGANISM_ID_MAX, YEAR_MAX, YEAR_MIN, canonical_int


@pytest.mark.parametrize(
    ("value", "expected"),
    [("0", 0), ("9606", 9606), (str(ORGANISM_ID_MAX), ORGANISM_ID_MAX)],
)
def test_canonical_int_accepts_canonical_decimals(value: str, expected: int) -> None:
    assert canonical_int(value, maximum=ORGANISM_ID_MAX) == expected


@pytest.mark.parametrize(
    "value",
    [
        "",
        "09606",
        "00",
        "+9606",
        "-9606",
        "\uff19\uff16\uff10\uff16",
        "9_606",
        " 9606",
        "9606 ",
        "9606\n",
        "²",
        "9606.0",
        str(ORGANISM_ID_MAX + 1),
        "9" * 39,
        "9" * 5000,
    ],
)
def test_canonical_int_rejects_other_forms(value: str) -> None:
    assert canonical_int(value, maximum=ORGANISM_ID_MAX) is None


def test_canonical_int_checks_the_minimum_of_years() -> None:
    assert canonical_int("2020", minimum=YEAR_MIN, maximum=YEAR_MAX) == 2020
    assert canonical_int("999", minimum=YEAR_MIN, maximum=YEAR_MAX) is None
    assert canonical_int("10000", minimum=YEAR_MIN, maximum=YEAR_MAX) is None


@given(st.one_of(st.text(max_size=60), st.integers(0, 2**32).map(str), st.text("0123456789", max_size=12)))
def test_canonical_int_accepts_exactly_the_strings_that_round_trip_through_int(value: str) -> None:
    number = canonical_int(value, maximum=ORGANISM_ID_MAX)
    if number is None:
        assert not (value.isascii() and value.isdigit() and str(int(value)) == value and int(value) <= ORGANISM_ID_MAX)
    else:
        assert str(number) == value
