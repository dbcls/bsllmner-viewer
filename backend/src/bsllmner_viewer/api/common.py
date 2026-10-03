"""Helpers shared by routers."""

from __future__ import annotations

from typing import Any

from pydantic.alias_generators import to_camel

from bsllmner_viewer.api.schemas import Clause, DatasetVersionRef
from bsllmner_viewer.api.store import Store
from bsllmner_viewer.dsl.ast import FieldClause, Node, Range, clause, leaves, normalize, range_clause
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.serializer import serialize
from bsllmner_viewer.dsl.transform import exclude_dimensions
from bsllmner_viewer.store.organisms import ORGANISM_NAMES


def version_ref(store: Store) -> DatasetVersionRef:
    return DatasetVersionRef(
        name=store.version.name,
        created_at=store.version.created_at,
        model=store.version.model,
        digest=store.version_digest,
    )


def camelize_keys(value: Any) -> Any:
    """The value with the keys of every nested object converted to camelCase."""
    if isinstance(value, dict):
        return {to_camel(str(k)): camelize_keys(v) for k, v in value.items()}
    if isinstance(value, list):
        return [camelize_keys(v) for v in value]
    return value


def q_of(ast: Node | None) -> str | None:
    """The canonical condition string: nested same-op groups flattened, values bare when they can be."""
    return None if ast is None else serialize(normalize(ast))


def aggregation_population(ast: Node | None, dimensions: list[str], facet_self_exclude: bool) -> Node | None:
    return exclude_dimensions(ast, dimensions) if facet_self_exclude else ast


def to_field_clause(item: Clause) -> FieldClause:
    if item.from_ is not None or item.to is not None:
        if item.from_ is None or item.to is None or item.value is not None:
            raise DslError(type=ErrorType.invalid_ast, detail="a range clause needs 'from' and 'to' and no 'value'")
        return range_clause(item.field, item.from_, item.to)
    if item.value is None:
        raise DslError(type=ErrorType.invalid_ast, detail="a clause needs 'value' or 'from'/'to'")
    return clause(item.field, item.value)


def from_field_clause(item: FieldClause) -> Clause:
    if isinstance(item.value, Range):
        return Clause(field=item.field, from_=item.value.from_, to=item.value.to)
    return Clause(field=item.field, value=item.value)


def condition_labels(store: Store, ast: Node | None) -> dict[str, str]:
    """Labels of the term IDs and organism IDs that appear in a condition."""
    if ast is None:
        return {}
    terms: list[str] = []
    organisms: list[int] = []
    for leaf in leaves(ast):
        field = store.field_set.get(leaf.field)
        if field is None or not isinstance(leaf.value, str):
            continue
        if field.kind == "term":
            terms.append(leaf.value)
        elif field.kind == "organism" and leaf.value.isdigit():
            organisms.append(int(leaf.value))
    labels: dict[str, str] = {}
    with store.cursor() as cur:
        if terms:
            marks = ", ".join("?" for _ in terms)
            for term_id, label in cur.execute(
                f"SELECT term_id, label FROM term WHERE term_id IN ({marks})", terms
            ).fetchall():
                if label:
                    labels[str(term_id)] = str(label)
        if organisms:
            marks = ", ".join("?" for _ in organisms)
            rows = cur.execute(
                f"SELECT organism_id, organism_name FROM ({ORGANISM_NAMES}) WHERE organism_id IN ({marks})",
                organisms,
            ).fetchall()
            for organism_id, name in rows:
                if name:
                    labels[str(organism_id)] = str(name)
    return labels


def split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    seen: list[str] = []
    for part in value.split(","):
        item = part.strip()
        if item and item not in seen:
            seen.append(item)
    return seen
