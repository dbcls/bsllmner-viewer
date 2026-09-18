"""Request dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Query, Request

from bsllmner_viewer.api.store import Store
from bsllmner_viewer.dsl.ast import Node
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.validator import validate


def get_store(request: Request) -> Store:
    store: Store = request.app.state.store
    return store


StoreDep = Annotated[Store, Depends(get_store)]

QParam = Annotated[
    str | None,
    Query(
        description="Condition in the DSL. Omitted or empty means the whole population.",
        examples=['disease:"MONDO:0007254"'],
    ),
]


def parse_condition(store: Store, q: str | None) -> Node | None:
    """Parse and validate a condition, or None when q is empty."""
    if q is None or not q.strip():
        return None
    ast = parse(q)
    validate(ast, store.field_set)
    return ast
