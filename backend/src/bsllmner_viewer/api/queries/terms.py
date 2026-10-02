"""Term search and children."""

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
    cur: duckdb.DuckDBPyConnection, fields: list[str], query: str, limit: int
) -> list[tuple[str, str, str | None, str]]:
    """Annotated terms of the fields whose label, synonym, or ID contains the query, as (field, term, label, ontology).

    Best matches first: an exact label or ID, then the terms assigned directly to the most BioSamples.
    """
    if not fields:
        return []
    text = query.strip()
    marks = ", ".join("?" for _ in fields)
    order = "c.n_direct DESC, c.n_biosample DESC, t.term_id, f.position"
    if not text:
        rows = cur.execute(
            f"""
            SELECT c.field, t.term_id, t.label, t.ontology
            FROM field_term_count c JOIN term t ON t.term_id = c.term_id JOIN field f ON f.name = c.field
            WHERE c.field IN ({marks})
            ORDER BY {order} LIMIT ?
            """,
            [*fields, limit],
        ).fetchall()
    else:
        exact = text.casefold()
        rows = cur.execute(
            f"""
            SELECT c.field, t.term_id, t.label, t.ontology
            FROM (
                SELECT DISTINCT field, term_id FROM term_search
                WHERE field IN ({marks}) AND text LIKE ? ESCAPE '\\'
            ) s
            JOIN field_term_count c ON c.field = s.field AND c.term_id = s.term_id
            JOIN term t ON t.term_id = s.term_id
            JOIN field f ON f.name = c.field
            ORDER BY (lower(t.label) = ?) DESC, (lower(t.term_id) = ?) DESC, {order} LIMIT ?
            """,
            [*fields, like_pattern(text), exact, exact, limit],
        ).fetchall()
    return [(str(field), str(t), label, str(ontology)) for field, t, label, ontology in rows]


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


def path_labels(cur: duckdb.DuckDBPyConnection, term_ids: list[str]) -> dict[str, list[str]]:
    """For each term, the labels along one parent chain from a root to the term's parent.

    At each step the chain follows the most specific parent: the one with the fewest descendants.
    """
    chains: dict[str, list[str]] = {t: [] for t in term_ids}
    current: dict[str, str] = {t: t for t in term_ids}
    seen: dict[str, set[str]] = {t: {t} for t in term_ids}
    for _ in range(MAX_PATH):
        frontier = sorted(set(current.values()))
        if not frontier:
            break
        marks = ", ".join("?" for _ in frontier)
        parents: Any = cur.execute(
            f"""
            SELECT p.term_id, p.parent_id, t.label FROM term_parent p JOIN term t ON t.term_id = p.parent_id
            WHERE p.term_id IN ({marks}) AND p.parent_id NOT LIKE 'BFO:%'
            """,
            frontier,
        ).fetchall()
        if not parents:
            break
        candidates = sorted({str(parent) for _, parent, _ in parents})
        marks = ", ".join("?" for _ in candidates)
        sizes = {
            str(ancestor): int(n)
            for ancestor, n in cur.execute(
                f"SELECT ancestor, count(*) FROM term_closure WHERE ancestor IN ({marks}) GROUP BY ancestor", candidates
            ).fetchall()
        }
        best: dict[str, tuple[int, str, str]] = {}
        for term, parent, label in parents:
            key = (sizes.get(str(parent), 0), str(parent), str(label or parent))
            if str(term) not in best or key < best[str(term)]:
                best[str(term)] = key
        advanced: dict[str, str] = {}
        for origin, term in current.items():
            step = best.get(term)
            if step is None or step[1] in seen[origin]:
                continue
            seen[origin].add(step[1])
            chains[origin].append(step[2])
            advanced[origin] = step[1]
        current = advanced
    return {t: list(reversed(labels)) for t, labels in chains.items()}


def counted_elements(
    cur: duckdb.DuckDBPyConnection, pop: Population, dim: FieldDef, term_ids: list[str], unit: Unit
) -> tuple[dict[str, int], dict[str, tuple[int, int]], dict[str, bool]]:
    return (
        element_counts(cur, pop, dim, term_ids, unit),
        term_status_counts(cur, pop, dim, term_ids, unit),
        has_children(cur, dim, term_ids),
    )
