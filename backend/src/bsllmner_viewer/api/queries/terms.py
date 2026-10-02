"""Term search and children."""

from __future__ import annotations

from typing import Any, NamedTuple

import duckdb

from bsllmner_viewer.api.queries.aggregate import element_counts, has_children, term_status_counts
from bsllmner_viewer.api.queries.core import Population
from bsllmner_viewer.api.schemas import Unit
from bsllmner_viewer.dsl.compile import like_pattern
from bsllmner_viewer.dsl.fields import FieldDef

MAX_PATH = 8


class Candidate(NamedTuple):
    """A term found by a search, before it is counted."""

    field: str
    term_id: str
    label: str | None
    ontology: str
    tier: int
    """How the term matches: 0 when its label or ID is the query, 1 when one of them contains it, 2 otherwise."""
    synonym: str | None
    """For tier 2, the synonym that contains the query."""


def search_terms(cur: duckdb.DuckDBPyConnection, fields: list[str], query: str, limit: int) -> list[Candidate]:
    """Annotated terms of the fields whose label, synonym, or ID contains the query, best tier first.

    Within a tier, the terms assigned directly to the most BioSamples come first. A broad term that is counted only
    through its descendants is therefore not chosen ahead of the terms in use.
    """
    if not fields:
        return []
    text = query.strip()
    marks = ", ".join("?" for _ in fields)
    order = "c.n_direct DESC, c.n_biosample DESC, t.term_id, f.position"
    if not text:
        rows = cur.execute(
            f"""
            SELECT c.field, t.term_id, t.label, t.ontology, 0 AS tier
            FROM field_term_count c JOIN term t ON t.term_id = c.term_id JOIN field f ON f.name = c.field
            WHERE c.field IN ({marks})
            ORDER BY {order} LIMIT ?
            """,
            [*fields, limit],
        ).fetchall()
        return [Candidate(str(f), str(t), label, str(o), 0, None) for f, t, label, o, _ in rows]
    exact = text.casefold()
    pattern = like_pattern(text)
    rows = cur.execute(
        f"""
        SELECT c.field, t.term_id, t.label, t.ontology,
               CASE WHEN lower(t.label) = ? OR lower(t.term_id) = ? THEN 0
                    WHEN lower(t.label) LIKE ? ESCAPE '\\' OR lower(t.term_id) LIKE ? ESCAPE '\\' THEN 1
                    ELSE 2 END AS tier
        FROM (
            SELECT DISTINCT field, term_id FROM term_search
            WHERE field IN ({marks}) AND text LIKE ? ESCAPE '\\'
        ) s
        JOIN field_term_count c ON c.field = s.field AND c.term_id = s.term_id
        JOIN term t ON t.term_id = s.term_id
        JOIN field f ON f.name = c.field
        ORDER BY tier, {order} LIMIT ?
        """,
        [exact, exact, pattern, pattern, *fields, pattern, limit],
    ).fetchall()
    synonyms = _matched_synonyms(cur, sorted({str(t) for _, t, _, _, tier in rows if tier == 2}), pattern)
    return [
        Candidate(str(f), str(t), label, str(o), int(tier), synonyms.get(str(t)) if tier == 2 else None)
        for f, t, label, o, tier in rows
    ]


def _matched_synonyms(cur: duckdb.DuckDBPyConnection, term_ids: list[str], pattern: str) -> dict[str, str]:
    """For each term, its shortest synonym that matches the pattern, in the synonym's own case."""
    if not term_ids:
        return {}
    marks = ", ".join("?" for _ in term_ids)
    rows = cur.execute(
        f"""
        SELECT term_id, synonym FROM term_synonym
        WHERE term_id IN ({marks}) AND lower(synonym) LIKE ? ESCAPE '\\'
        ORDER BY term_id, length(synonym), synonym
        """,
        [*term_ids, pattern],
    ).fetchall()
    found: dict[str, str] = {}
    for term_id, synonym in rows:
        found.setdefault(str(term_id), str(synonym))
    return found


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
