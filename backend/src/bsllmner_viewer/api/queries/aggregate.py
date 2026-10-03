"""Distribution, cross-tabulation, and trend."""

from __future__ import annotations

import math
from dataclasses import dataclass

import duckdb

from bsllmner_viewer.api.queries.core import Population, bp_join, count_expr, population_years
from bsllmner_viewer.api.queries.dimensions import Membership, clauses_for, membership
from bsllmner_viewer.api.schemas import Element, TermElement, Unit
from bsllmner_viewer.dsl.fields import MAPPED_EXACT, MAPPED_SELECTED, FieldDef

EXPECTED_MIN = 5.0
RATIO_THRESHOLD = 2.0
RESIDUAL_THRESHOLD = 2.0


def population_total(cur: duckdb.DuckDBPyConnection, pop: Population, unit: Unit) -> int:
    row = cur.execute(
        f"WITH {pop.cte()} SELECT {count_expr(unit)} FROM pop p {bp_join(unit)}", list(pop.params)
    ).fetchone()
    return int(row[0]) if row else 0


def element_counts(
    cur: duckdb.DuckDBPyConnection, pop: Population, dim: FieldDef, elements: list[str], unit: Unit
) -> dict[str, int]:
    """Count of each element in the population, in the unit."""
    if not elements:
        return {}
    member = membership(dim, elements)
    rows = cur.execute(
        f"WITH {pop.cte()}, m AS ({member.sql}) "
        f"SELECT m.element, {count_expr(unit, 'm')} FROM m {bp_join(unit, 'm')} GROUP BY m.element",
        [*pop.params, *member.params],
    ).fetchall()
    counts = {str(e): int(n) for e, n in rows}
    return {e: counts.get(e, 0) for e in elements}


def term_status_counts(
    cur: duckdb.DuckDBPyConnection, pop: Population, dim: FieldDef, elements: list[str], unit: Unit
) -> dict[str, tuple[int, int]]:
    """(exact, selected) counts per term: units carrying a mapped_exact / mapped_selected annotation under it."""
    if not elements or dim.kind != "term":
        return {}
    placeholders = ", ".join("?" for _ in elements)
    rows = cur.execute(
        f"WITH {pop.cte()}, m AS ("
        "SELECT p.biosample, p.experiment, c.ancestor AS element, a.status FROM pop p "
        "JOIN annotation a ON a.biosample = p.biosample AND a.field = ? AND a.term_id IS NOT NULL "
        f"JOIN term_closure c ON c.descendant = a.term_id AND c.ancestor IN ({placeholders})) "
        f"SELECT m.element, "
        f"{count_expr(unit, 'm')} FILTER (WHERE m.status = '{MAPPED_EXACT}'), "
        f"{count_expr(unit, 'm')} FILTER (WHERE m.status = '{MAPPED_SELECTED}') "
        f"FROM m {bp_join(unit, 'm')} GROUP BY m.element",
        [*pop.params, dim.annotation_field, *elements],
    ).fetchall()
    found = {str(e): (int(a), int(b)) for e, a, b in rows}
    return {e: found.get(e, (0, 0)) for e in elements}


def has_children(
    cur: duckdb.DuckDBPyConnection, pop: Population, dim: FieldDef, elements: list[str], unit: Unit
) -> dict[str, bool]:
    """Whether a term has a direct child term with a count above 0 in the population, in the unit."""
    if not elements or dim.kind != "term":
        return dict.fromkeys(elements, False)
    placeholders = ", ".join("?" for _ in elements)
    # Counting BioProjects needs a linked BioProject; the other units count every match of the population.
    linked = "JOIN biosample_bioproject bp ON bp.biosample = p.biosample" if unit == "bioproject" else ""
    # A direct child has a count exactly when a BioSample of the population has a term strictly below the term: every
    # such term is under one of the direct children.
    rows = cur.execute(
        f"WITH {pop.cte()}, below AS ("
        "SELECT DISTINCT a.biosample, tc.ancestor FROM term_closure tc "
        "JOIN annotation a ON a.term_id = tc.descendant AND a.field = ? "
        f"WHERE tc.ancestor IN ({placeholders}) AND tc.depth > 0) "
        f"SELECT DISTINCT below.ancestor FROM below JOIN pop p ON p.biosample = below.biosample {linked}",
        [*pop.params, dim.annotation_field, *elements],
    ).fetchall()
    found = {str(r[0]) for r in rows}
    return {e: e in found for e in elements}


def parents_within(cur: duckdb.DuckDBPyConnection, elements: list[str]) -> dict[str, list[str]]:
    """For each term, the elements that are its direct parents, in the order of the elements."""
    found: dict[str, set[str]] = {e: set() for e in elements}
    if len(elements) > 1:
        placeholders = ", ".join("?" for _ in elements)
        rows = cur.execute(
            f"SELECT term_id, parent_id FROM term_parent "
            f"WHERE term_id IN ({placeholders}) AND parent_id IN ({placeholders})",
            [*elements, *elements],
        ).fetchall()
        for term_id, parent_id in rows:
            found[str(term_id)].add(str(parent_id))
    return {e: [p for p in elements if p in found[e]] for e in elements}


def term_elements(
    cur: duckdb.DuckDBPyConnection,
    pop: Population,
    dim: FieldDef,
    ids: list[str],
    unit: Unit,
    labels: dict[str, str],
    counts: dict[str, int],
) -> list[TermElement]:
    """Term elements with the counts of their mapped statuses, whether child terms have counts, and parents in `ids`."""
    statuses = term_status_counts(cur, pop, dim, ids, unit)
    children = has_children(cur, pop, dim, ids, unit)
    parents = parents_within(cur, ids)
    return [
        TermElement(
            value=e,
            label=labels.get(e, e),
            clauses=clauses_for(dim, e),
            count=counts.get(e, 0),
            count_exact=statuses.get(e, (0, 0))[0],
            count_selected=statuses.get(e, (0, 0))[1],
            has_children=children.get(e, False),
            parents=parents.get(e, []),
        )
        for e in ids
    ]


def axis_elements(
    cur: duckdb.DuckDBPyConnection,
    pop: Population,
    dim: FieldDef,
    ids: list[str],
    unit: Unit,
    labels: dict[str, str],
    counts: dict[str, int],
) -> list[TermElement | Element]:
    """Elements of a dimension: term dimensions carry the term details, the others only the count."""
    if dim.kind == "term":
        return [*term_elements(cur, pop, dim, ids, unit, labels, counts)]
    return [Element(value=e, label=labels.get(e, e), clauses=clauses_for(dim, e), count=counts.get(e, 0)) for e in ids]


@dataclass(frozen=True, slots=True)
class CrosstabResult:
    total: int
    row_counts: dict[str, int]
    col_counts: dict[str, int]
    cells: dict[tuple[str, str], int]


def crosstab(
    cur: duckdb.DuckDBPyConnection,
    pop: Population,
    row_dim: FieldDef,
    row_elements: list[str],
    col_dim: FieldDef,
    col_elements: list[str],
    unit: Unit,
) -> CrosstabResult:
    total = population_total(cur, pop, unit)
    row_counts = element_counts(cur, pop, row_dim, row_elements, unit)
    col_counts = element_counts(cur, pop, col_dim, col_elements, unit)
    cells: dict[tuple[str, str], int] = {}
    if row_elements and col_elements:
        rm: Membership = membership(row_dim, row_elements)
        cm: Membership = membership(col_dim, col_elements)
        rows = cur.execute(
            f"WITH {pop.cte()}, rm AS ({rm.sql}), cm AS ({cm.sql}), "
            "m AS (SELECT rm.biosample, rm.experiment, rm.element AS row_e, cm.element AS col_e "
            "FROM rm JOIN cm ON cm.biosample = rm.biosample AND cm.experiment = rm.experiment) "
            f"SELECT m.row_e, m.col_e, {count_expr(unit, 'm')} FROM m {bp_join(unit, 'm')} GROUP BY 1, 2",
            [*pop.params, *rm.params, *cm.params],
        ).fetchall()
        cells = {(str(r), str(c)): int(n) for r, c, n in rows}
    return CrosstabResult(total, row_counts, col_counts, cells)


def expected_and_residual(observed: int, row: int, col: int, total: int) -> tuple[float | None, float | None]:
    """Expected count and adjusted standardized residual under independence."""
    if total <= 0:
        return None, None
    expected = row * col / total
    denominator = expected * (1 - row / total) * (1 - col / total)
    if denominator <= 0:
        return expected, None
    return expected, (observed - expected) / math.sqrt(denominator)


def ratio_to_expected(observed: int, expected: float | None) -> float | None:
    """The count of a cell divided by its expected count."""
    if not expected:
        return None
    return observed / expected


def classify(observed: int, expected: float | None, ratio: float | None, residual: float | None) -> str | None:
    """
    The class of a cell. Under and over need both a ratio of at most half or at least twice the expected count and a
    residual beyond the threshold: the ratio is the size of the difference, and the residual grows with the population.
    """
    if expected is None or expected < EXPECTED_MIN:
        return None
    if observed == 0:
        return "gap"
    if ratio is None or residual is None:
        return None
    if ratio <= 1 / RATIO_THRESHOLD and residual <= -RESIDUAL_THRESHOLD:
        return "under"
    if ratio >= RATIO_THRESHOLD and residual >= RESIDUAL_THRESHOLD:
        return "over"
    return None


def trend_total(cur: duckdb.DuckDBPyConnection, pop: Population, unit: Unit) -> dict[int, int]:
    """Count of the population per publication year."""
    rows = cur.execute(
        f"WITH {pop.cte()} SELECT p.year, {count_expr(unit)} FROM pop p {bp_join(unit)} "
        "WHERE p.year IS NOT NULL GROUP BY 1",
        list(pop.params),
    ).fetchall()
    return {int(y): int(n) for y, n in rows}


def trend(
    cur: duckdb.DuckDBPyConnection, pop: Population, dim: FieldDef, elements: list[str], unit: Unit
) -> tuple[list[int], dict[tuple[str, int], int]]:
    """Counts per (element, publication year) and the sorted years present in the population."""
    years = population_years(cur, pop)
    if not elements:
        return years, {}
    member = membership(dim, elements)
    rows = cur.execute(
        f"WITH {pop.cte()}, m AS ({member.sql}) "
        "SELECT m.element, p.year, "
        f"{count_expr(unit, 'm')} FROM m JOIN pop p ON p.biosample = m.biosample AND p.experiment = m.experiment "
        f"{bp_join(unit, 'm')} WHERE p.year IS NOT NULL GROUP BY 1, 2",
        [*pop.params, *member.params],
    ).fetchall()
    return years, {(str(e), int(y)): int(n) for e, y, n in rows}
