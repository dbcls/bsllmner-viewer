"""Fields of the condition DSL and the operators each accepts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

type FieldKind = Literal["term", "status", "assay", "organism", "date", "bioproject"]
type Operator = Literal["eq", "between"]

type Status = Literal[
    "mapped_exact",
    "mapped_selected",
    "unmapped_no_candidate",
    "unmapped_rejected",
    "not_stated",
    "extraction_failed",
]
type GroupName = Literal["mapped", "unmapped", "no_value"]

STATUS_GROUPS: dict[GroupName, tuple[Status, ...]] = {
    "mapped": ("mapped_exact", "mapped_selected"),
    "unmapped": ("unmapped_no_candidate", "unmapped_rejected"),
    "no_value": ("not_stated", "extraction_failed"),
}
STATUSES: tuple[Status, ...] = tuple(s for group in STATUS_GROUPS.values() for s in group)

MAPPED_EXACT: Final[Status] = "mapped_exact"
MAPPED_SELECTED: Final[Status] = "mapped_selected"
MAPPED: Final[GroupName] = "mapped"

STATUS_SUFFIX = "_status"


def expand_status(value: str) -> tuple[Status, ...]:
    """Statuses matched by a status value: a group expands to the statuses under it."""
    for group, statuses in STATUS_GROUPS.items():
        if value == group:
            return statuses
    return tuple(status for status in STATUSES if status == value)


@dataclass(frozen=True, slots=True)
class FieldDef:
    name: str
    kind: FieldKind
    annotation_field: str | None = None

    @property
    def operators(self) -> tuple[Operator, ...]:
        if self.kind == "date":
            return ("eq", "between")
        return ("eq",)


_FIXED: tuple[FieldDef, ...] = (
    FieldDef("library_strategy", "assay"),
    FieldDef("organism_id", "organism"),
    FieldDef("date_published", "date"),
    FieldDef("bioproject", "bioproject"),
)


class FieldSet:
    """The DSL fields of one dataset: fixed fields plus two per annotation field."""

    def __init__(self, annotation_fields: tuple[str, ...] | list[str]) -> None:
        self.annotation_fields: tuple[str, ...] = tuple(annotation_fields)
        defs: dict[str, FieldDef] = {}
        for name in self.annotation_fields:
            defs[name] = FieldDef(name, "term", name)
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
