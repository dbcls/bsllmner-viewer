"""Condition DSL operations: parse and element selection."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import TypeAdapter

from bsllmner_viewer.api.common import condition_labels, q_of, to_api_clause, to_field_clause, version_ref
from bsllmner_viewer.api.deps import StoreDep, parse_condition
from bsllmner_viewer.api.problems import DSL_SLUGS, error_responses
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
    responses=error_responses(bad_request=DSL_SLUGS),
    response_model=ParseResponse,
    summary="Parse a condition string into an AST",
    description=(
        "Parses `q` into the AST of the DDBJ Search API, with the display labels of its term IDs and organism IDs. "
        "An invalid condition gets 400 with the column of the error, so this operation also checks a condition "
        'before it is used. See "Condition DSL" in /llms-full.txt.'
    ),
)
def parse_dsl(
    store: StoreDep, q: Annotated[str, Query(min_length=1, description="The condition to parse. It cannot be empty")]
) -> ParseResponse:
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
    responses=error_responses(bad_request=(*DSL_SLUGS, "invalid-ast")),
    response_model=ConditionResponse,
    summary="Apply the clauses of an aggregation element to a condition",
    description=(
        "Applies the clauses of an aggregation element to `q`. `toggle` adds the clauses, or removes them when all of "
        "them are already in `q`. `narrow` adds each clause as a new `AND` conjunct. "
        'See "From elements to conditions" in /llms-full.txt for where a clause goes.'
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
    responses=error_responses(bad_request=DSL_SLUGS),
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
