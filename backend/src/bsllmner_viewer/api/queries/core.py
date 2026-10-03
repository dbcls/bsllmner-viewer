"""Population and counting shared by every query."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import duckdb

from bsllmner_viewer.api.schemas import Unit
from bsllmner_viewer.dsl.ast import Node
from bsllmner_viewer.dsl.compile import TempTable, compile_condition
from bsllmner_viewer.dsl.fields import FieldSet


@dataclass(frozen=True, slots=True)
class Population:
    """`pop` CTE body selecting the BioSamples with a linked experiment that match a condition.

    A keyword scans the searchable text of the BioSamples. A request evaluates the population with many SQL
    statements, so the BioSamples that match a keyword are selected once, at the first use of the population on a
    cursor, into a temporary table. A temporary table belongs to its cursor and disappears with it.
    """

    sql: str
    params: tuple[Any, ...]
    tables: tuple[TempTable, ...] = ()

    def cte(self, cur: duckdb.DuckDBPyConnection) -> str:
        for table in self.tables:
            cur.execute(f"CREATE TEMP TABLE IF NOT EXISTS {table.name} AS {table.sql}", list(table.params))
        return f"pop AS ({self.sql})"


def population(ast: Node | None, fields: FieldSet, keyword_tables: bool = True) -> Population:
    predicate = compile_condition(ast, fields, alias="pn", keyword_tables=keyword_tables)
    sql = (
        "SELECT pn.biosample, pn.experiment, pn.library_strategy, pn.organism_id, pn.date_published, "
        "pn.year "
        f"FROM population pn WHERE {predicate.sql}"
    )
    return Population(sql, tuple(predicate.params), tuple(predicate.tables))


def population_years(cur: duckdb.DuckDBPyConnection, pop: Population) -> list[int]:
    """The sorted publication years present in the population."""
    rows = cur.execute(
        f"WITH {pop.cte(cur)} SELECT DISTINCT p.year FROM pop p WHERE p.year IS NOT NULL ORDER BY 1", list(pop.params)
    ).fetchall()
    return [int(r[0]) for r in rows]


def count_expr(unit: Unit, alias: str = "p", bp_alias: str = "bp") -> str:
    if unit == "biosample":
        return f"count(DISTINCT {alias}.biosample)"
    if unit == "sra-experiment":
        return f"count(DISTINCT {alias}.experiment)"
    return f"count(DISTINCT {bp_alias}.bioproject)"


def bp_join(unit: Unit, alias: str = "p", bp_alias: str = "bp") -> str:
    """Join needed to count BioProjects; empty for the other units."""
    if unit != "bioproject":
        return ""
    return f"LEFT JOIN biosample_bioproject {bp_alias} ON {bp_alias}.biosample = {alias}.biosample"
