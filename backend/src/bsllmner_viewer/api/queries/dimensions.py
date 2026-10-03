"""Aggregation dimensions: which BioSamples belong to which element, and the clause each element stands for."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import duckdb

from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.queries.core import Population, population_years
from bsllmner_viewer.api.schemas import NAME_MAX_LENGTH, Clause
from bsllmner_viewer.dsl.canonical import ORGANISM_ID_MAX, YEAR_MAX, YEAR_MIN, canonical_int
from bsllmner_viewer.dsl.fields import FieldDef, FieldKind, FieldSet
from bsllmner_viewer.dsl.validator import TERM_ID_RE

DIMENSION_KINDS: frozenset[FieldKind] = frozenset({"term", "assay", "organism", "date"})
# The dimensions whose elements the condition can name, and whose default elements are ordered by their count.
NAMED_BY_CONDITION: frozenset[FieldKind] = frozenset({"term", "assay", "organism"})


@dataclass(frozen=True, slots=True)
class Membership:
    """SQL selecting `(biosample, experiment, element)` rows from the `pop` CTE."""

    sql: str
    params: tuple[Any, ...]


def dimension(fields: FieldSet, name: str) -> FieldDef:
    field = fields.get(name)
    if field is None:
        raise ApiError("unknown-field", 400, f"unknown field {name!r}; the fields are {_names(fields, None)}")
    if field.kind not in DIMENSION_KINDS:
        raise ApiError(
            "invalid-dimension",
            400,
            f"{name!r} is not an aggregation dimension; the dimensions are {_names(fields, DIMENSION_KINDS)}",
        )
    return field


def _names(fields: FieldSet, kinds: frozenset[FieldKind] | None) -> str:
    found = (fields.get(name) for name in fields.names())
    return ", ".join(f.name for f in found if f is not None and (kinds is None or f.kind in kinds))


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
            tuple(int(e) for e in elements),
        )
    return Membership(
        "SELECT p.biosample, p.experiment, CAST(p.year AS VARCHAR) AS element FROM pop p "
        f"WHERE p.year IN ({placeholders})",
        tuple(int(e) for e in elements),
    )


def clauses_for(dim: FieldDef, element: str) -> list[Clause]:
    if dim.kind == "date":
        return [Clause(field=dim.name, from_=f"{element}-01-01", to=f"{element}-12-31")]
    return [Clause(field=dim.name, value=element)]


def default_elements(
    cur: duckdb.DuckDBPyConnection,
    dim: FieldDef,
    pop: Population,
    limit: int,
) -> list[str]:
    """Elements shown when the request does not name them."""
    pop_cte, pop_params = pop.cte(), pop.params
    if dim.kind == "term":
        rows = cur.execute(
            f"WITH {pop_cte} SELECT a.term_id, count(DISTINCT p.biosample) AS n FROM pop p "
            "JOIN annotation a ON a.biosample = p.biosample AND a.field = ? AND a.term_id IS NOT NULL "
            "GROUP BY a.term_id ORDER BY n DESC, a.term_id LIMIT ?",
            [*pop_params, dim.annotation_field, limit],
        ).fetchall()
        return [str(r[0]) for r in rows]
    if dim.kind == "assay":
        rows = cur.execute(
            f"WITH {pop_cte} SELECT p.library_strategy, count(DISTINCT p.biosample) AS n FROM pop p "
            "GROUP BY 1 ORDER BY n DESC, 1 LIMIT ?",
            [*pop_params, limit],
        ).fetchall()
        return [str(r[0]) for r in rows]
    if dim.kind == "organism":
        rows = cur.execute(
            f"WITH {pop_cte} SELECT p.organism_id, count(DISTINCT p.biosample) AS n FROM pop p "
            "WHERE p.organism_id IS NOT NULL GROUP BY 1 ORDER BY n DESC, 1 LIMIT ?",
            [*pop_params, limit],
        ).fetchall()
        return [str(r[0]) for r in rows]
    return [str(year) for year in population_years(cur, pop)]


def check_elements(fields: FieldSet, dim: FieldDef, elements: list[str]) -> None:
    """Reject a named element that is too long, and one whose clause a condition would reject: a term that is not
    `PREFIX:ID`, an assay that is not a target assay, and an organism or year that is not a canonical decimal number in
    range."""
    for element in elements:
        if len(element) > NAME_MAX_LENGTH:
            raise ApiError("invalid-element", 400, f"an element has at most {NAME_MAX_LENGTH} characters")
    if dim.kind == "term":
        for element in elements:
            if not TERM_ID_RE.match(element):
                raise ApiError(
                    "invalid-element",
                    400,
                    f"{dim.name!r} element must be a term ID in the form PREFIX:ID, got {element!r}; "
                    "find term IDs with GET /api/terms",
                )
        return
    if dim.kind == "assay":
        if fields.target_assays is not None:
            for element in elements:
                if element not in fields.target_assays:
                    raise ApiError(
                        "invalid-element",
                        400,
                        f"{dim.name!r} element must be one of the assays of the dataset "
                        f"({', '.join(fields.target_assays)}), got {element!r}",
                    )
        return
    if dim.kind == "organism":
        low, high = 0, ORGANISM_ID_MAX
    elif dim.kind == "date":
        low, high = YEAR_MIN, YEAR_MAX
    else:
        return
    for element in elements:
        if canonical_int(element, minimum=low, maximum=high) is None:
            raise ApiError(
                "invalid-element",
                400,
                f"{dim.name} element must be an integer from {low} to {high} without a sign or a leading zero: "
                f"{element!r}",
            )


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
        return {e: organisms.get(int(e)) or e for e in elements}
    return {e: e for e in elements}
