"""Aggregation dimensions: which BioSamples belong to which element, and the clause each element stands for."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import duckdb

from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.schemas import Clause
from bsllmner_viewer.dsl.fields import STATUS_GROUPS, FieldDef, FieldKind, FieldSet, expand_status

DIMENSION_KINDS: frozenset[FieldKind] = frozenset({"term", "status", "assay", "organism", "date"})


@dataclass(frozen=True, slots=True)
class Membership:
    """SQL selecting `(biosample, experiment, element)` rows from the `pop` CTE."""

    sql: str
    params: tuple[Any, ...]


def dimension(fields: FieldSet, name: str) -> FieldDef:
    field = fields.get(name)
    if field is None or field.kind not in DIMENSION_KINDS:
        raise ApiError("invalid-dimension", 400, f"{name!r} is not an aggregation dimension")
    return field


def membership(dim: FieldDef, elements: list[str]) -> Membership:
    if not elements:
        return Membership("SELECT p.biosample, p.experiment, NULL::VARCHAR AS element FROM pop p WHERE FALSE", ())
    placeholders = ", ".join("?" for _ in elements)
    if dim.kind == "term":
        return Membership(
            "SELECT p.biosample, p.experiment, ac.ancestor AS element FROM pop p "
            "JOIN annotation_closure ac ON ac.biosample = p.biosample AND ac.field = ? "
            f"AND ac.ancestor IN ({placeholders})",
            (dim.annotation_field, *elements),
        )
    if dim.kind == "status":
        parts: list[str] = []
        params: list[Any] = []
        for element in elements:
            statuses = expand_status(element)
            if not statuses:
                raise ApiError("invalid-element", 400, f"unknown status {element!r}")
            marks = ", ".join("?" for _ in statuses)
            parts.append(
                "SELECT p.biosample, p.experiment, ? AS element FROM pop p "
                f"JOIN annotation a ON a.biosample = p.biosample AND a.field = ? AND a.status IN ({marks})"
            )
            params.extend([element, dim.annotation_field, *statuses])
        return Membership(" UNION ALL ".join(parts), tuple(params))
    if dim.kind == "assay":
        return Membership(
            "SELECT p.biosample, p.experiment, p.library_strategy AS element FROM pop p "
            f"WHERE p.library_strategy IN ({placeholders})",
            tuple(elements),
        )
    if dim.kind == "organism":
        return Membership(
            "SELECT p.biosample, p.experiment, CAST(p.organism_id AS VARCHAR) AS element FROM pop p "
            f"WHERE p.organism_id IN ({placeholders})",
            tuple(_int(e, "organism_id") for e in elements),
        )
    return Membership(
        "SELECT p.biosample, p.experiment, CAST(p.year AS VARCHAR) AS element FROM pop p "
        f"WHERE p.year IN ({placeholders})",
        tuple(_int(e, "year") for e in elements),
    )


def clauses_for(dim: FieldDef, element: str) -> list[Clause]:
    if dim.kind == "date":
        return [Clause(field=dim.name, from_=f"{element}-01-01", to=f"{element}-12-31")]
    return [Clause(field=dim.name, value=element)]


def default_elements(
    cur: duckdb.DuckDBPyConnection,
    dim: FieldDef,
    pop_cte: str,
    pop_params: tuple[Any, ...],
    limit: int,
    expanded_status: bool,
) -> list[str]:
    """Elements shown when the request does not name them."""
    if dim.kind == "term":
        rows = cur.execute(
            f"WITH {pop_cte} SELECT a.term_id, count(DISTINCT p.biosample) AS n FROM pop p "
            "JOIN annotation a ON a.biosample = p.biosample AND a.field = ? AND a.term_id IS NOT NULL "
            "GROUP BY a.term_id ORDER BY n DESC, a.term_id LIMIT ?",
            [*pop_params, dim.annotation_field, limit],
        ).fetchall()
        return [str(r[0]) for r in rows]
    if dim.kind == "status":
        if expanded_status:
            return [s for group in STATUS_GROUPS.values() for s in group]
        return list(STATUS_GROUPS)
    if dim.kind == "assay":
        rows = cur.execute(
            f"WITH {pop_cte} SELECT p.library_strategy, count(*) AS n FROM pop p GROUP BY 1 ORDER BY n DESC, 1 LIMIT ?",
            [*pop_params, limit],
        ).fetchall()
        return [str(r[0]) for r in rows]
    if dim.kind == "organism":
        rows = cur.execute(
            f"WITH {pop_cte} SELECT p.organism_id, count(*) AS n FROM pop p WHERE p.organism_id IS NOT NULL "
            "GROUP BY 1 ORDER BY n DESC, 1 LIMIT ?",
            [*pop_params, limit],
        ).fetchall()
        return [str(r[0]) for r in rows]
    rows = cur.execute(
        f"WITH {pop_cte} SELECT DISTINCT p.year FROM pop p WHERE p.year IS NOT NULL ORDER BY 1", list(pop_params)
    ).fetchall()
    return [str(r[0]) for r in rows]


def _int(value: str, what: str) -> int:
    try:
        return int(value)
    except ValueError as e:
        raise ApiError("invalid-element", 400, f"{what} element must be an integer: {value!r}") from e


def labels_for(
    cur: duckdb.DuckDBPyConnection, dim: FieldDef, elements: list[str], organisms: dict[int, str | None]
) -> dict[str, str]:
    if dim.kind == "term":
        if not elements:
            return {}
        placeholders = ", ".join("?" for _ in elements)
        rows = cur.execute(f"SELECT term_id, label FROM term WHERE term_id IN ({placeholders})", elements).fetchall()
        found = {str(t): str(label) if label else str(t) for t, label in rows}
        return {e: found.get(e, e) for e in elements}
    if dim.kind == "organism":
        return {e: organisms.get(int(e)) or e for e in elements if e.lstrip("-").isdigit()}
    if dim.kind == "status":
        return {e: e.replace("_", " ") for e in elements}
    return {e: e for e in elements}
