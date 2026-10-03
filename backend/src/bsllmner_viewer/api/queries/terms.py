"""Term search and children."""

from __future__ import annotations

from typing import Any, NamedTuple

import duckdb

from bsllmner_viewer.api.queries.core import Population

MAX_PATH = 8


def like_pattern(value: str) -> str:
    """A substring pattern for `LIKE lower(?) ESCAPE '\\'`. Only the escape happens here: the stored text and the
    pattern are both lowered by the database, so that they fold characters the same way."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class Candidate(NamedTuple):
    """A term found by a search, before it is counted."""

    field: str
    term_id: str
    label: str | None
    ontology: str
    tier: int
    """How the term matches: 0 when its label or ID is the query, 1 when a synonym is, 2 when its label or ID contains
    the query, and 3 when only a synonym does."""
    synonym: str | None
    """For tiers 1 and 3, the synonym that decides the match."""


SYNONYM_TIERS = (1, 3)


def search_terms(
    cur: duckdb.DuckDBPyConnection, populations: dict[str, Population | None], query: str, limit: int
) -> list[Candidate]:
    """The terms of the fields that a search lists, best first. Each field has its population; None is the whole one.

    Without a query, the terms are those assigned directly to the most BioSamples of the population, as the default
    elements of a distribution. With a query, every annotated term whose label, synonym, or ID contains it is a
    candidate, so that a broad term counted only through its descendants is still found. The candidates are ordered by
    tier, then by the BioSamples assigned directly in the population, then in the whole dataset.
    """
    groups: dict[Population | None, list[str]] = {}
    for name, pop in populations.items():
        groups.setdefault(pop, []).append(name)
    text = query.strip()
    rows: list[tuple[Any, ...]] = []
    for pop, names in groups.items():
        rows += _listed(cur, names, pop, limit) if not text else _matched(cur, names, pop, text, limit)
    rows.sort(key=(lambda r: (r[4], -r[5], -r[6], -r[7], r[1], r[8])) if text else (lambda r: (-r[5], r[1], r[8])))
    rows = rows[:limit]
    synonyms = (
        _matched_synonyms(cur, sorted({str(r[1]) for r in rows if r[4] in SYNONYM_TIERS}), like_pattern(text))
        if text
        else {}
    )
    return [
        Candidate(str(f), str(t), label, str(o), int(tier), synonyms.get(str(t)) if tier in SYNONYM_TIERS else None)
        for f, t, label, o, tier, *_ in rows
    ]


# Every row: field, term ID, label, ontology, tier, BioSamples assigned directly in the population, BioSamples
# assigned directly in the whole dataset, BioSamples counted with descendants in the whole dataset, and the position of
# the field.
_COLUMNS = "c.field, t.term_id, t.label, t.ontology"
_DATASET = "c.n_direct, c.n_biosample, f.position"


def _listed(
    cur: duckdb.DuckDBPyConnection, names: list[str], pop: Population | None, limit: int
) -> list[tuple[Any, ...]]:
    marks = ", ".join("?" for _ in names)
    if pop is None:
        return cur.execute(
            f"""
            SELECT {_COLUMNS}, 0, c.n_direct, {_DATASET}
            FROM field_term_count c JOIN term t ON t.term_id = c.term_id JOIN field f ON f.name = c.field
            WHERE c.field IN ({marks}) AND c.n_direct > 0
            ORDER BY c.n_direct DESC, t.term_id, f.position LIMIT ?
            """,
            [*names, limit],
        ).fetchall()
    return cur.execute(
        f"""
        WITH {pop.cte(cur)},
        d AS (
            SELECT a.field, a.term_id, count(DISTINCT p.biosample) AS n FROM pop p
            JOIN annotation a ON a.biosample = p.biosample AND a.term_id IS NOT NULL AND a.field IN ({marks})
            GROUP BY 1, 2
        )
        SELECT {_COLUMNS}, 0, d.n, {_DATASET}
        FROM d JOIN field_term_count c ON c.field = d.field AND c.term_id = d.term_id
        JOIN term t ON t.term_id = d.term_id JOIN field f ON f.name = d.field
        ORDER BY d.n DESC, t.term_id, f.position LIMIT ?
        """,
        [*pop.params, *names, limit],
    ).fetchall()


def _matched(
    cur: duckdb.DuckDBPyConnection, names: list[str], pop: Population | None, text: str, limit: int
) -> list[tuple[Any, ...]]:
    marks = ", ".join("?" for _ in names)
    pattern = like_pattern(text)
    tier = """CASE WHEN lower(t.label) = lower(?) OR lower(t.term_id) = lower(?) THEN 0
                   WHEN EXISTS (
                       SELECT 1 FROM term_synonym y WHERE y.term_id = t.term_id AND lower(y.synonym) = lower(?)
                   ) THEN 1
                   WHEN lower(t.label) LIKE lower(?) ESCAPE '\\' OR lower(t.term_id) LIKE lower(?) ESCAPE '\\' THEN 2
                   ELSE 3 END"""
    matched = (
        f"SELECT DISTINCT field, term_id FROM term_search WHERE field IN ({marks}) AND text LIKE lower(?) ESCAPE '\\'"
    )
    if pop is None:
        return cur.execute(
            f"""
            WITH s AS ({matched})
            SELECT {_COLUMNS}, {tier} AS tier, coalesce(c.n_direct, 0) AS n, {_DATASET}
            FROM s JOIN field_term_count c ON c.field = s.field AND c.term_id = s.term_id
            JOIN term t ON t.term_id = s.term_id JOIN field f ON f.name = s.field
            ORDER BY tier, n DESC, c.n_direct DESC, c.n_biosample DESC, t.term_id, f.position LIMIT ?
            """,
            [*names, pattern, text, text, text, pattern, pattern, limit],
        ).fetchall()
    return cur.execute(
        f"""
        WITH {pop.cte(cur)}, s AS ({matched}),
        d AS (
            SELECT a.field, a.term_id, count(DISTINCT p.biosample) AS n FROM pop p
            JOIN annotation a ON a.biosample = p.biosample
            JOIN s ON s.field = a.field AND s.term_id = a.term_id
            GROUP BY 1, 2
        )
        SELECT {_COLUMNS}, {tier} AS tier, coalesce(d.n, 0) AS n, {_DATASET}
        FROM s JOIN field_term_count c ON c.field = s.field AND c.term_id = s.term_id
        LEFT JOIN d ON d.field = s.field AND d.term_id = s.term_id
        JOIN term t ON t.term_id = s.term_id JOIN field f ON f.name = s.field
        ORDER BY tier, n DESC, c.n_direct DESC, c.n_biosample DESC, t.term_id, f.position LIMIT ?
        """,
        [*pop.params, *names, pattern, text, text, text, pattern, pattern, limit],
    ).fetchall()


def _matched_synonyms(cur: duckdb.DuckDBPyConnection, term_ids: list[str], pattern: str) -> dict[str, str]:
    """For each term, its shortest synonym that matches the pattern, in the synonym's own case."""
    if not term_ids:
        return {}
    marks = ", ".join("?" for _ in term_ids)
    rows = cur.execute(
        f"""
        SELECT term_id, synonym FROM term_synonym
        WHERE term_id IN ({marks}) AND lower(synonym) LIKE lower(?) ESCAPE '\\'
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
