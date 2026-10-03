"""Condition DSL operations: parse and element selection."""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import TypeAdapter

from bsllmner_viewer.api.common import condition_labels, q_of, to_api_clause, to_field_clause, version_ref
from bsllmner_viewer.api.deps import StoreDep, parse_condition
from bsllmner_viewer.api.schemas import (
    AstNode,
    ConditionResponse,
    KeywordRequest,
    ParseResponse,
    SelectRequest,
)
from bsllmner_viewer.api.store import Store
from bsllmner_viewer.dsl.ast import Node, normalize
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.keyword import keyword_text, typed_keywords
from bsllmner_viewer.dsl.parser import check_length
from bsllmner_viewer.dsl.serde import ast_to_json
from bsllmner_viewer.dsl.transform import narrow, replace_keywords, select_element, selected_clauses
from bsllmner_viewer.dsl.validator import validate

router = APIRouter(tags=["Condition"])

_AST = TypeAdapter[AstNode](AstNode)


def _ast_model(store: Store, ast: Node) -> AstNode:
    return _AST.validate_python(ast_to_json(ast, store.field_set))


def _condition_response(store: Store, ast: Node | None) -> ConditionResponse:
    if ast is not None:
        ast = normalize(ast)
        validate(ast, store.field_set)
    dsl = q_of(ast)
    if dsl is not None:
        check_length(dsl)
    return ConditionResponse(
        dataset_version=version_ref(store),
        dsl=dsl,
        ast=None if ast is None else _ast_model(store, ast),
        labels=condition_labels(store, ast),
        selected=[to_api_clause(c) for c in selected_clauses(ast)],
        keyword=keyword_text(ast),
    )


@router.get(
    "/dsl/parse",
    operation_id="parseCondition",
    response_model=ParseResponse,
    summary="Parse a condition string into an AST",
)
def parse_dsl(store: StoreDep, q: str = Query(min_length=1)) -> ParseResponse:
    ast = parse_condition(store, q)
    if ast is None:
        raise DslError(type=ErrorType.unexpected_token, detail="empty query string", column=1, length=1)
    canonical = q_of(ast) or ""
    check_length(canonical)
    return ParseResponse(
        dataset_version=version_ref(store),
        q=canonical,
        ast=_ast_model(store, ast),
        labels=condition_labels(store, ast),
        selected=[to_api_clause(c) for c in selected_clauses(ast)],
        keyword=keyword_text(ast),
    )


@router.post(
    "/dsl/select",
    operation_id="selectElement",
    response_model=ConditionResponse,
    summary="Apply the clauses of an aggregation element to a condition",
    description=(
        "In `toggle` mode, adds each clause to the condition: joined with OR into the top-level clause group of the "
        "same field when one exists, otherwise as a new AND conjunct. When every clause is already present, the "
        "clauses are removed instead. In `narrow` mode, adds each clause as a new AND conjunct; with the population "
        "of an aggregation as `q`, the result matches the BioSamples or experiments counted by the element."
    ),
)
def select_dsl(store: StoreDep, body: SelectRequest) -> ConditionResponse:
    ast = parse_condition(store, body.q)
    clauses = [to_field_clause(c) for c in body.clauses]
    result = narrow(ast, clauses) if body.mode == "narrow" else select_element(ast, clauses)
    return _condition_response(store, result)


@router.post(
    "/dsl/keyword",
    operation_id="setKeyword",
    response_model=ConditionResponse,
    summary="Replace the keywords of a condition",
    description=(
        "Replaces the keywords among the top-level AND conjuncts of `q` with the keywords of `keyword`, read as a "
        "search box reads text: quoted parts are phrases, and the other words form one keyword. A part is quoted by "
        "double quotes, or by a `'` at the start of a word and a `'` at the end of a word. A `'` inside a word or only "
        "at its end, as in `Alzheimer's` or `3'`, is part of the word. `AND`, `OR`, and `NOT` are ordinary words. An "
        "empty `keyword` removes the keywords."
    ),
)
def keyword_dsl(store: StoreDep, body: KeywordRequest) -> ConditionResponse:
    ast = parse_condition(store, body.q)
    result = replace_keywords(ast, typed_keywords(body.keyword))
    return _condition_response(store, result)
