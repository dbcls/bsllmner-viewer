"""Term search and children for one annotation field."""

from __future__ import annotations

from typing import Any

import duckdb

from bsllmner_viewer.api.queries.aggregate import element_counts, has_children, term_status_counts
from bsllmner_viewer.api.queries.core import Population
from bsllmner_viewer.api.schemas import Unit
from bsllmner_viewer.dsl.compile import like_pattern
from bsllmner_viewer.dsl.fields import FieldDef

MAX_PATH = 8


def search_terms(
    cur: duckdb.DuckDBPyConnection, field: str, query: str, limit: int
) -> list[tuple[str, str | None, str]]:
    """Terms annotated in the population whose label, synonym, or ID contains the query; best matches first."""
    pattern = like_pattern(query.strip()) if query.strip() else "%"
    exact = query.strip().casefold()
    rows = cur.execute(
        """
        SELECT t.term_id, t.label, t.ontology, c.n_direct, c.n_biosample
        FROM field_term_count c JOIN term t ON t.term_id = c.term_id
        WHERE c.field = ? AND (
            lower(t.label) LIKE ? ESCAPE '\\' OR lower(t.term_id) LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM term_synonym s WHERE s.term_id = t.term_id AND lower(s.synonym) LIKE ? ESCAPE '\\')
        )
        ORDER BY (lower(t.label) = ?) DESC, (lower(t.term_id) = ?) DESC, c.n_direct DESC, c.n_biosample DESC, t.term_id
        LIMIT ?
        """,
        [field, pattern, pattern, pattern, exact, exact, limit],
    ).fetchall()
    return [(str(t), label, str(ontology)) for t, label, ontology, _, _ in rows]


def children_of(cur: duckdb.DuckDBPyConnection, field: str, term_id: str) -> list[tuple[str, str | None]]:
    rows = cur.execute(
        """
        SELECT t.term_id, t.label FROM term_parent p
        JOIN term t ON t.term_id = p.term_id
        JOIN field_term_count c ON c.term_id = p.term_id AND c.field = ?
        WHERE p.parent_id = ? ORDER BY c.n_direct DESC, c.n_biosample DESC, t.term_id
        """,
        [field, term_id],
    ).fetchall()
    return [(str(t), label) for t, label in rows]


def descendant_counts(cur: duckdb.DuckDBPyConnection, field: str, term_ids: list[str]) -> dict[str, int]:
    if not term_ids:
        return {}
    placeholders = ", ".join("?" for _ in term_ids)
    rows = cur.execute(
        f"""
        SELECT c.ancestor, count(*) FROM term_closure c
        JOIN field_term_count f ON f.term_id = c.descendant AND f.field = ?
        WHERE c.ancestor IN ({placeholders}) AND c.depth > 0 GROUP BY c.ancestor
        """,
        [field, *term_ids],
    ).fetchall()
    found = {str(t): int(n) for t, n in rows}
    return {t: found.get(t, 0) for t in term_ids}


def path_labels(cur: duckdb.DuckDBPyConnection, term_id: str) -> list[str]:
    """Labels along one parent chain from a root to the term's parent, following the most specific parent."""
    labels: list[str] = []
    current = term_id
    seen = {term_id}
    for _ in range(MAX_PATH):
        row: Any = cur.execute(
            """
            SELECT p.parent_id, t.label FROM term_parent p JOIN term t ON t.term_id = p.parent_id
            WHERE p.term_id = ? AND p.parent_id NOT LIKE 'BFO:%'
            ORDER BY (SELECT count(*) FROM term_closure c WHERE c.ancestor = p.parent_id) ASC, p.parent_id LIMIT 1
            """,
            [current],
        ).fetchone()
        if row is None or row[0] in seen:
            break
        seen.add(row[0])
        labels.append(str(row[1] or row[0]))
        current = str(row[0])
    labels.reverse()
    return labels


def counted_elements(
    cur: duckdb.DuckDBPyConnection, pop: Population, dim: FieldDef, term_ids: list[str], unit: Unit
) -> tuple[dict[str, int], dict[str, tuple[int, int]], dict[str, bool]]:
    return (
        element_counts(cur, pop, dim, term_ids, unit),
        term_status_counts(cur, pop, dim, term_ids, unit),
        has_children(cur, dim, term_ids),
    )
