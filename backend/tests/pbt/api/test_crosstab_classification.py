"""Expected counts, ratios, and classes of cross-tabulation cells."""

from __future__ import annotations

import math

from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.api.queries.aggregate import classify, expected_and_residual, ratio_to_expected


@st.composite
def cells(draw: st.DrawFn) -> tuple[int, int, int, int]:
    """A cell count, its row and column counts, and the population count, as a cross-tabulation can produce them."""
    total = draw(st.integers(min_value=0, max_value=5_000_000))
    row = draw(st.integers(min_value=0, max_value=total))
    col = draw(st.integers(min_value=0, max_value=total))
    observed = draw(st.integers(min_value=0, max_value=min(row, col)))
    return observed, row, col, total


def _measures(cell: tuple[int, int, int, int]) -> tuple[int, float | None, float | None, float | None, str | None]:
    observed, row, col, total = cell
    expected, residual = expected_and_residual(observed, row, col, total)
    ratio = ratio_to_expected(observed, expected)
    return observed, expected, ratio, residual, classify(observed, expected, ratio, residual)


@given(cells())
def test_ratio_to_expected_is_count_over_expected_or_null_without_expected(cell: tuple[int, int, int, int]) -> None:
    observed, expected, ratio, _, _ = _measures(cell)
    if expected is None or expected == 0:
        assert ratio is None
    else:
        assert ratio == observed / expected


@given(cells())
def test_classify_needs_both_ratio_and_residual_thresholds(cell: tuple[int, int, int, int]) -> None:
    observed, expected, ratio, residual, cls = _measures(cell)
    supported = expected is not None and expected >= 5
    assert (cls == "gap") == (supported and observed == 0)
    assert (cls == "under") == (
        supported and observed > 0 and ratio is not None and ratio <= 0.5 and residual is not None and residual <= -2
    )
    over = supported and ratio is not None and ratio >= 2 and residual is not None and residual >= 2
    assert (cls == "over") == over


@given(cells())
def test_classify_leaves_cells_between_half_and_twice_expected_unclassified(cell: tuple[int, int, int, int]) -> None:
    _, _, ratio, _, cls = _measures(cell)
    if ratio is not None and 0.5 < ratio < 2:
        assert cls is None


def test_classify_large_population_small_difference_unclassified() -> None:
    # A cell 0.6% above its expected count, in a column that holds most of the population: the residual alone passes.
    _, _, ratio, residual, cls = _measures((69_978, 74_959, 3_805_378, 4_100_500))
    assert ratio is not None
    assert residual is not None
    assert residual > 2
    assert 1 < ratio < 1.01
    assert cls is None


def test_classify_at_the_thresholds_of_the_ratio_the_residual_and_the_expected_count() -> None:
    assert classify(10, 5.0, 2.0, 2.0) == "over"
    assert classify(5, 10.0, 0.5, -2.0) == "under"
    assert classify(10, 5.0, 2.0, 1.99) is None
    assert classify(5, 10.0, 0.5, -1.99) is None
    assert classify(0, 4.99, 0.0, -2.2) is None


@given(cells())
def test_expected_and_residual_follow_the_formulas_of_the_docs(cell: tuple[int, int, int, int]) -> None:
    observed, row, col, total = cell
    expected, residual = expected_and_residual(observed, row, col, total)
    if total == 0:
        assert (expected, residual) == (None, None)
        return
    want_expected = row * col / total
    assert expected is not None
    assert math.isclose(expected, want_expected, rel_tol=1e-12, abs_tol=1e-12)
    if want_expected == 0 or row == total or col == total:
        assert residual is None
        return
    want_residual = (observed - want_expected) / math.sqrt(want_expected * (1 - row / total) * (1 - col / total))
    assert residual is not None
    assert math.isclose(residual, want_residual, rel_tol=1e-9, abs_tol=1e-9)
