"""Fields of the condition DSL and the operators each accepts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

type FieldKind = Literal["term", "value", "status", "assay", "organism", "date", "bioproject", "identifier", "title"]
type Operator = Literal["eq", "contains", "between"]

STATUS_GROUPS: dict[str, tuple[str, ...]] = {
    "mapped": ("mapped_exact", "mapped_selected"),
    "unmapped": ("unmapped_no_candidate", "unmapped_rejected"),
    "no_value": ("not_stated", "extraction_failed"),
}
STATUSES: tuple[str, ...] = tuple(s for group in STATUS_GROUPS.values() for s in group)

VALUE_SUFFIX = "_value"
STATUS_SUFFIX = "_status"


def expand_status(value: str) -> tuple[str, ...]:
    """Statuses matched by a status value: a group expands to the statuses under it."""
    if value in STATUS_GROUPS:
        return STATUS_GROUPS[value]
    if value in STATUSES:
        return (value,)
    return ()


@dataclass(frozen=True, slots=True)
class FieldDef:
    name: str
    kind: FieldKind
    annotation_field: str | None = None

    @property
    def operators(self) -> tuple[Operator, ...]:
        if self.kind == "date":
            return ("eq", "between")
        if self.kind in ("value", "title"):
            return ("contains",)
        return ("eq",)


_FIXED: tuple[FieldDef, ...] = (
    FieldDef("library_strategy", "assay"),
    FieldDef("organism_id", "organism"),
    FieldDef("date_created", "date"),
    FieldDef("bioproject", "bioproject"),
    FieldDef("identifier", "identifier"),
    FieldDef("title", "title"),
)


class FieldSet:
    """The DSL fields of one dataset: fixed fields plus three per annotation field."""

    def __init__(self, annotation_fields: tuple[str, ...] | list[str]) -> None:
        self.annotation_fields: tuple[str, ...] = tuple(annotation_fields)
        defs: dict[str, FieldDef] = {}
        for name in self.annotation_fields:
            defs[name] = FieldDef(name, "term", name)
            defs[name + VALUE_SUFFIX] = FieldDef(name + VALUE_SUFFIX, "value", name)
            defs[name + STATUS_SUFFIX] = FieldDef(name + STATUS_SUFFIX, "status", name)
        for fixed in _FIXED:
            defs[fixed.name] = fixed
        self._defs = defs

    def get(self, name: str) -> FieldDef | None:
        return self._defs.get(name)

    def __contains__(self, name: str) -> bool:
        return name in self._defs

    def names(self) -> tuple[str, ...]:
        return tuple(self._defs)

    def dimensions(self) -> tuple[str, ...]:
        """Fields usable as an aggregation dimension."""
        return tuple(
            name for name, d in self._defs.items() if d.kind in ("term", "status", "assay", "organism", "date")
        )
