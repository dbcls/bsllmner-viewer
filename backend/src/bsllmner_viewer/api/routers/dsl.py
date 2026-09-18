"""Condition DSL operations: parse, serialize, and element selection."""

from __future__ import annotations

from fastapi import APIRouter, Query

from bsllmner_viewer.api.common import condition_labels, q_of, to_field_clause, version_ref
from bsllmner_viewer.api.deps import StoreDep, parse_condition
from bsllmner_viewer.api.schemas import ConditionResponse, ParseResponse, SelectRequest, SerializeRequest
from bsllmner_viewer.dsl.ast import normalize
from bsllmner_viewer.dsl.serde import ast_to_json, json_to_ast
from bsllmner_viewer.dsl.transform import select_element
from bsllmner_viewer.dsl.validator import validate

router = APIRouter(tags=["dsl"])


@router.get("/dsl/parse", response_model=ParseResponse, summary="Parse a condition string into an AST")
def parse_dsl(store: StoreDep, q: str = Query(min_length=1)) -> ParseResponse:
    parsed = parse_condition(store, q)
    assert parsed is not None
    ast = normalize(parsed)
    return ParseResponse(
        dataset_version=version_ref(store),
        q=q_of(ast) or "",
        ast=ast_to_json(ast, store.field_set),
        labels=condition_labels(store, ast),
    )


@router.post("/dsl/serialize", response_model=ConditionResponse, summary="Serialize an AST into a condition string")
def serialize_dsl(store: StoreDep, body: SerializeRequest) -> ConditionResponse:
    ast = normalize(json_to_ast(body.ast, store.field_set))
    validate(ast, store.field_set)
    return ConditionResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        ast=ast_to_json(ast, store.field_set),
        labels=condition_labels(store, ast),
    )


@router.post(
    "/dsl/select",
    response_model=ConditionResponse,
    summary="Toggle the clauses of an aggregation element in a condition",
    description=(
        "Adds each clause to the condition: joined with OR into the top-level clause group of the same field when "
        "one exists, otherwise as a new AND conjunct. When every clause of the element is already present, "
        "the clauses are removed instead."
    ),
)
def select_dsl(store: StoreDep, body: SelectRequest) -> ConditionResponse:
    ast = parse_condition(store, body.q)
    clauses = [to_field_clause(c) for c in body.clauses]
    result = select_element(ast, clauses)
    if result is not None:
        result = normalize(result)
        validate(result, store.field_set)
    return ConditionResponse(
        dataset_version=version_ref(store),
        q=q_of(result),
        ast=None if result is None else ast_to_json(result, store.field_set),
        labels=condition_labels(store, result),
    )
