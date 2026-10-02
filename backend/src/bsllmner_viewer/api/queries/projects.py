"""BioProjects of a population."""

from __future__ import annotations

from typing import Literal

import duckdb

from bsllmner_viewer.api.queries.core import Population

type ProjectSort = Literal[
    "biosampleCount:desc",
    "biosampleCount:asc",
    "experimentCount:desc",
    "experimentCount:asc",
]

# A count breaks ties with the other count in the same direction, then with the accession, so each order is total.
_ORDER = {
    "biosampleCount:desc": "n_biosample DESC, n_experiment DESC, bioproject",
    "biosampleCount:asc": "n_biosample, n_experiment, bioproject",
    "experimentCount:desc": "n_experiment DESC, n_biosample DESC, bioproject",
    "experimentCount:asc": "n_experiment, n_biosample, bioproject",
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
