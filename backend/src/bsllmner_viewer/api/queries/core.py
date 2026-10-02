"""Population and counting shared by every query."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from bsllmner_viewer.api.schemas import Unit
from bsllmner_viewer.dsl.ast import Node
from bsllmner_viewer.dsl.compile import compile_condition
from bsllmner_viewer.dsl.fields import FieldSet


@dataclass(frozen=True, slots=True)
class Population:
    """`pop` CTE body selecting the records matching a condition."""

    sql: str
    params: tuple[Any, ...]

    def cte(self) -> str:
        return f"pop AS ({self.sql})"


def population(ast: Node | None, fields: FieldSet) -> Population:
    predicate = compile_condition(ast, fields, alias="r")
    sql = (
        "SELECT r.biosample, r.experiment, r.library_strategy, r.organism_id, r.date_created, r.year, r.title_norm "
        f"FROM record r WHERE {predicate.sql}"
    )
    return Population(sql, tuple(predicate.params))


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
