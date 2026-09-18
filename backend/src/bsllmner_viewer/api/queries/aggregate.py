"""Distribution, cross-tabulation, and trend."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import duckdb

from bsllmner_viewer.api.queries.core import Population, bp_join, count_expr
from bsllmner_viewer.api.queries.dimensions import Membership, membership
from bsllmner_viewer.api.schemas import Unit
from bsllmner_viewer.dsl.fields import FieldDef

EXPECTED_MIN = 5.0
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
        f"{count_expr(unit, 'm')} FILTER (WHERE m.status = 'mapped_exact'), "
        f"{count_expr(unit, 'm')} FILTER (WHERE m.status = 'mapped_selected') "
        f"FROM m {bp_join(unit, 'm')} GROUP BY m.element",
        [*pop.params, dim.annotation_field, *elements],
    ).fetchall()
    found = {str(e): (int(a), int(b)) for e, a, b in rows}
    return {e: found.get(e, (0, 0)) for e in elements}


def has_children(cur: duckdb.DuckDBPyConnection, dim: FieldDef, elements: list[str]) -> dict[str, bool]:
    """Whether a term has child terms that are annotated in the population."""
    if not elements or dim.kind != "term":
        return dict.fromkeys(elements, False)
    placeholders = ", ".join("?" for _ in elements)
    rows = cur.execute(
        f"SELECT DISTINCT tp.parent_id FROM term_parent tp "
        "JOIN field_term_count c ON c.term_id = tp.term_id AND c.field = ? "
        f"WHERE tp.parent_id IN ({placeholders})",
        [dim.annotation_field, *elements],
    ).fetchall()
    found = {str(r[0]) for r in rows}
    return {e: e in found for e in elements}


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


def classify(observed: int, expected: float | None, residual: float | None) -> str | None:
    if expected is None or expected < EXPECTED_MIN:
        return None
    if observed == 0:
        return "gap"
    if residual is None:
        return None
    if residual <= -RESIDUAL_THRESHOLD:
        return "under"
    if residual >= RESIDUAL_THRESHOLD:
        return "over"
    return None


def trend(
    cur: duckdb.DuckDBPyConnection, pop: Population, dim: FieldDef, elements: list[str], unit: Unit
) -> tuple[list[int], dict[tuple[str, int], int]]:
    """Counts per (element, creation year) and the sorted years present in the population."""
    years = [
        int(r[0])
        for r in cur.execute(
            f"WITH {pop.cte()} SELECT DISTINCT p.year FROM pop p WHERE p.year IS NOT NULL ORDER BY 1", list(pop.params)
        ).fetchall()
    ]
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


def status_counts(cur: duckdb.DuckDBPyConnection, pop: Population, field: str, unit: Unit) -> dict[str, int]:
    """Count of units per status (six statuses) for an annotation field."""
    rows = cur.execute(
        f"WITH {pop.cte()} SELECT a.status, {count_expr(unit)} FROM pop p "
        f"JOIN annotation a ON a.biosample = p.biosample AND a.field = ? {bp_join(unit)} GROUP BY a.status",
        [*pop.params, field],
    ).fetchall()
    return {str(s): int(n) for s, n in rows}


def group_status_counts(
    cur: duckdb.DuckDBPyConnection, pop: Population, field: str, unit: Unit, groups: dict[str, tuple[str, ...]]
) -> dict[str, int]:
    """Count of units per status group. A unit with several statuses counts in each group it has."""
    out: dict[str, int] = {}
    for group, statuses in groups.items():
        placeholders = ", ".join("?" for _ in statuses)
        row: Any = cur.execute(
            f"WITH {pop.cte()} SELECT {count_expr(unit)} FROM pop p "
            "JOIN annotation a ON a.biosample = p.biosample AND a.field = ? "
            f"AND a.status IN ({placeholders}) {bp_join(unit)}",
            [*pop.params, field, *statuses],
        ).fetchone()
        out[group] = int(row[0]) if row else 0
    return out
