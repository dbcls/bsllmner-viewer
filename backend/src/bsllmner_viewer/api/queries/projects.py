"""BioProjects of a population and the composition of their annotations."""

from __future__ import annotations

from typing import Literal

import duckdb

from bsllmner_viewer.api.queries.core import Population
from bsllmner_viewer.api.schemas import Composition, CompositionSegment

type ProjectSort = Literal["biosample", "experiment", "accession"]

_ORDER = {
    "biosample": "n_biosample DESC, n_experiment DESC, bioproject",
    "experiment": "n_experiment DESC, n_biosample DESC, bioproject",
    "accession": "bioproject",
}


def count_projects(cur: duckdb.DuckDBPyConnection, pop: Population) -> int:
    row = cur.execute(
        f"WITH {pop.cte()} SELECT count(DISTINCT bp.bioproject) FROM pop p "
        "JOIN biosample_bioproject bp ON bp.biosample = p.biosample",
        list(pop.params),
    ).fetchone()
    return int(row[0]) if row else 0


def project_page(
    cur: duckdb.DuckDBPyConnection, pop: Population, sort: ProjectSort, page: int, per_page: int
) -> list[tuple[str, str | None, int, int, list[str]]]:
    rows = cur.execute(
        f"""
        WITH {pop.cte()}
        SELECT bp.bioproject, any_value(b.title), count(DISTINCT p.biosample) AS n_biosample,
               count(DISTINCT p.experiment) AS n_experiment,
               list(DISTINCT p.library_strategy ORDER BY p.library_strategy) AS assays
        FROM pop p
        JOIN biosample_bioproject bp ON bp.biosample = p.biosample
        LEFT JOIN bioproject b ON b.accession = bp.bioproject
        GROUP BY bp.bioproject
        ORDER BY {_ORDER[sort]}
        LIMIT ? OFFSET ?
        """,
        [*pop.params, per_page, (page - 1) * per_page],
    ).fetchall()
    return [(str(a), t, int(nb), int(ne), [str(x) for x in (assays or []) if x]) for a, t, nb, ne, assays in rows]


def compositions(
    cur: duckdb.DuckDBPyConnection, pop: Population, bioprojects: list[str], fields: list[str]
) -> dict[str, list[Composition]]:
    """Per BioProject and field: most frequent term, other terms, unmapped values, and BioSamples without a value."""
    out: dict[str, list[Composition]] = {b: [] for b in bioprojects}
    if not bioprojects or not fields:
        return out
    placeholders = ", ".join("?" for _ in bioprojects)
    field_marks = ", ".join("?" for _ in fields)
    rows = cur.execute(
        f"""
        WITH {pop.cte()},
        members AS (
            SELECT DISTINCT bp.bioproject, p.biosample FROM pop p
            JOIN biosample_bioproject bp ON bp.biosample = p.biosample WHERE bp.bioproject IN ({placeholders})
        ),
        per_sample AS (
            SELECT m.bioproject, a.field, m.biosample,
                   CASE WHEN bool_or(a.term_id IS NOT NULL) THEN 'term'
                        WHEN bool_or(a.status LIKE 'unmapped%') THEN 'unmapped'
                        ELSE 'no_value' END AS kind,
                   arg_min(a.term_id, a.value_index) FILTER (WHERE a.term_id IS NOT NULL) AS term_id,
                   arg_min(a.term_label, a.value_index) FILTER (WHERE a.term_id IS NOT NULL) AS label
            FROM members m JOIN annotation a ON a.biosample = m.biosample AND a.field IN ({field_marks})
            GROUP BY m.bioproject, a.field, m.biosample
        )
        SELECT bioproject, field, kind, term_id, label, count(*) AS n
        FROM per_sample GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, n DESC
        """,
        [*pop.params, *bioprojects, *fields],
    ).fetchall()
    grouped: dict[tuple[str, str], list[tuple[str, str | None, str | None, int]]] = {}
    for bp, field, kind, term_id, label, n in rows:
        grouped.setdefault((str(bp), str(field)), []).append((str(kind), term_id, label, int(n)))
    for bp in bioprojects:
        for field in fields:
            items = grouped.get((bp, field), [])
            total = sum(n for _, _, _, n in items)
            terms = [i for i in items if i[0] == "term"]
            segments: list[CompositionSegment] = []
            if terms:
                top = terms[0]
                segments.append(CompositionSegment(kind="term", label=top[2] or top[1], term_id=top[1], count=top[3]))
                other = sum(n for _, _, _, n in terms[1:])
                if other:
                    segments.append(CompositionSegment(kind="other", label=None, term_id=None, count=other))
            unmapped = sum(n for k, _, _, n in items if k == "unmapped")
            if unmapped:
                segments.append(CompositionSegment(kind="unmapped", label=None, term_id=None, count=unmapped))
            no_value = sum(n for k, _, _, n in items if k == "no_value")
            if no_value:
                segments.append(CompositionSegment(kind="no_value", label=None, term_id=None, count=no_value))
            out[bp].append(Composition(field=field, total=total, segments=segments))
    return out
