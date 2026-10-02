"""BioSample or experiment entries and per-BioSample details for a page of results."""

from __future__ import annotations

from typing import Any

import duckdb
import orjson

from bsllmner_viewer.api.queries.core import Population
from bsllmner_viewer.api.schemas import AnnotationValue, EntryItem, EntryType, Organism


def count_entries(cur: duckdb.DuckDBPyConnection, pop: Population, unit: EntryType) -> int:
    expr = "count(DISTINCT p.biosample)" if unit == "biosample" else "count(*)"
    row = cur.execute(f"WITH {pop.cte()} SELECT {expr} FROM pop p", list(pop.params)).fetchone()
    return int(row[0]) if row else 0


def page_keys(
    cur: duckdb.DuckDBPyConnection, pop: Population, unit: EntryType, page: int, per_page: int
) -> list[tuple[str, str | None]]:
    """(biosample, experiment) keys of one page, ordered by accession."""
    offset = (page - 1) * per_page
    if unit == "biosample":
        rows = cur.execute(
            f"WITH {pop.cte()} SELECT DISTINCT p.biosample FROM pop p ORDER BY 1 LIMIT ? OFFSET ?",
            [*pop.params, per_page, offset],
        ).fetchall()
        return [(str(r[0]), None) for r in rows]
    rows = cur.execute(
        f"WITH {pop.cte()} SELECT p.biosample, p.experiment FROM pop p ORDER BY 1, 2 LIMIT ? OFFSET ?",
        [*pop.params, per_page, offset],
    ).fetchall()
    return [(str(r[0]), str(r[1])) for r in rows]


def entry_rows(
    cur: duckdb.DuckDBPyConnection, pop: Population, keys: list[tuple[str, str | None]], fields: tuple[str, ...]
) -> list[EntryItem]:
    if not keys:
        return []
    accessions = sorted({k[0] for k in keys})
    placeholders = ", ".join("?" for _ in accessions)
    details = {
        str(r[0]): r
        for r in cur.execute(
            "SELECT accession, title, organism_id, organism_name, date_created FROM biosample "
            f"WHERE accession IN ({placeholders})",
            accessions,
        ).fetchall()
    }
    experiments: dict[str, list[tuple[str, str | None]]] = {}
    for bs, ex, strategy in cur.execute(
        f"WITH {pop.cte()} SELECT p.biosample, p.experiment, p.library_strategy FROM pop p "
        f"WHERE p.biosample IN ({placeholders}) ORDER BY 1, 2",
        [*pop.params, *accessions],
    ).fetchall():
        experiments.setdefault(str(bs), []).append((str(ex), strategy))
    bioprojects: dict[str, list[str]] = {}
    for bs, bp in cur.execute(
        f"SELECT biosample, bioproject FROM biosample_bioproject WHERE biosample IN ({placeholders}) ORDER BY 1, 2",
        accessions,
    ).fetchall():
        bioprojects.setdefault(str(bs), []).append(str(bp))
    assemblies: dict[str, list[str]] = {}
    for ex, assembly in cur.execute(
        "SELECT experiment, assembly FROM chip_atlas WHERE experiment IN "
        f"(SELECT experiment FROM biosample_experiment WHERE biosample IN ({placeholders})) ORDER BY 1, 2",
        accessions,
    ).fetchall():
        assemblies.setdefault(str(ex), []).append(str(assembly))
    annotations: dict[str, dict[str, list[AnnotationValue]]] = {}
    for bs, field, value, status, term_id, label in cur.execute(
        "SELECT biosample, field, extracted_value, status, term_id, term_label FROM annotation "
        f"WHERE biosample IN ({placeholders}) ORDER BY biosample, field, value_index",
        accessions,
    ).fetchall():
        annotations.setdefault(str(bs), {}).setdefault(str(field), []).append(
            AnnotationValue(value=value, status=str(status), term_id=term_id, label=label)
        )
    rows: list[EntryItem] = []
    for bs, ex in keys:
        detail = details.get(bs)
        exps = experiments.get(bs, [])
        shown = [e for e in exps if ex is None or e[0] == ex]
        rows.append(
            EntryItem(
                identifier=bs if ex is None else ex,
                type="biosample" if ex is None else "sra-experiment",
                biosample=bs,
                experiments=[e[0] for e in shown],
                title=detail[1] if detail else None,
                organism=organism_of(detail[2], detail[3]) if detail else None,
                library_strategy=sorted({e[1] for e in shown if e[1]}),
                bioprojects=bioprojects.get(bs, []),
                date_created=detail[4].isoformat() if detail and detail[4] else None,
                chip_atlas=sorted({a for e in shown for a in assemblies.get(e[0], [])}),
                annotations={f: annotations.get(bs, {}).get(f, []) for f in fields},
            )
        )
    return rows


def organism_of(organism_id: int | None, name: str | None) -> Organism | None:
    return None if organism_id is None else Organism(identifier=str(organism_id), name=name)


def attributes_of(raw: Any) -> list[dict[str, Any]]:
    data = orjson.loads(raw) if isinstance(raw, str | bytes) else raw
    return list(data) if isinstance(data, list) else []
