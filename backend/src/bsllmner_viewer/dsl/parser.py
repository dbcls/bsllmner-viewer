"""Condition string to AST."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from lark import Lark, Token, v_args
from lark.exceptions import LarkError, UnexpectedCharacters, UnexpectedEOF, UnexpectedInput, UnexpectedToken
from lark.visitors import Transformer_NonRecursive

from bsllmner_viewer.dsl.ast import BoolOp, FieldClause, FreeText, Node, Position, Range
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.validator import MAX_DEPTH, check_depth

MAX_LENGTH = 4096

_LARK = Lark(
    (Path(__file__).with_name("grammar.lark")).read_text(encoding="utf-8"),
    parser="lalr",
    lexer="contextual",
    propagate_positions=True,
    maybe_placeholders=False,
)
_RANGE_SPLIT = re.compile(r"\s+TO\s+")
_PHRASE_UNESCAPE = re.compile(r"\\(.)", flags=re.DOTALL)


def _position(meta: Any) -> Position:
    column = getattr(meta, "column", None) or 1
    end_column = getattr(meta, "end_column", None) or (column + 1)
    return Position(column=column, length=max(end_column - column, 1))


@v_args(meta=True, inline=True)
class _ToAst(Transformer_NonRecursive):  # type: ignore[type-arg]
    def start(self, _meta: Any, expr: Node) -> Node:
        return expr

    def or_expr(self, _meta: Any, *items: Any) -> Node:
        operands = [item for item in items if not isinstance(item, Token)]
        if len(operands) == 1:
            return operands[0]  # type: ignore[no-any-return]
        return BoolOp(op="OR", children=tuple(operands), position=_position(_meta))

    def and_expr(self, _meta: Any, *items: Any) -> Node:
        operands = [item for item in items if not isinstance(item, Token)]
        if len(operands) == 1:
            return operands[0]  # type: ignore[no-any-return]
        return BoolOp(op="AND", children=tuple(operands), position=_position(_meta))

    def not_op(self, _meta: Any, _not: Token, inner: Node) -> BoolOp:
        return BoolOp(op="NOT", children=(inner,), position=_position(_meta))

    def atom_passthrough(self, _meta: Any, inner: Node) -> Node:
        return inner

    def field_clause(self, _meta: Any, field: Token, payload: tuple[str, str | Range]) -> FieldClause:
        kind, value = payload
        return FieldClause(field=str(field), value_kind=kind, value=value, position=_position(_meta))  # type: ignore[arg-type]

    def v_phrase(self, _meta: Any, tok: Token) -> tuple[str, str]:
        return ("phrase", _PHRASE_UNESCAPE.sub(lambda m: m.group(1), str(tok)[1:-1]))

    def v_range(self, _meta: Any, tok: Token) -> tuple[str, Range]:
        inner = str(tok)[1:-1]
        parts = _RANGE_SPLIT.split(inner, maxsplit=1)
        if len(parts) != 2:
            return ("range", Range(from_=inner, to=inner))
        return ("range", Range(from_=parts[0], to=parts[1]))

    def v_wildcard(self, _meta: Any, tok: Token) -> tuple[str, str]:
        return ("wildcard", str(tok))

    def v_date(self, _meta: Any, tok: Token) -> tuple[str, str]:
        return ("date", str(tok))

    def v_word(self, _meta: Any, tok: Token) -> tuple[str, str]:
        return ("word", str(tok))

    def ft_phrase(self, _meta: Any, tok: Token) -> FreeText:
        return FreeText(
            value=_PHRASE_UNESCAPE.sub(lambda m: m.group(1), str(tok)[1:-1]),
            is_phrase=True,
            position=_position(_meta),
        )

    def ft_word(self, _meta: Any, *toks: Token) -> FreeText:
        return FreeText(value=" ".join(str(t) for t in toks), is_phrase=False, position=_position(_meta))


def check_length(dsl: str, max_length: int = MAX_LENGTH) -> None:
    """Raise DslError(unexpected_token) when a condition string is longer than `max_length`."""
    if len(dsl) > max_length:
        raise DslError(
            type=ErrorType.unexpected_token,
            detail=f"query string too long: {len(dsl)} characters (max {max_length})",
            column=max_length + 1,
            length=1,
        )


def parse(dsl: str, *, max_length: int = MAX_LENGTH) -> Node:
    """Parse a condition string. Raises DslError(unexpected_token) on syntax errors and empty input."""
    check_length(dsl, max_length)
    if not dsl.strip():
        raise DslError(type=ErrorType.unexpected_token, detail="empty query string", column=1, length=1)
    try:
        tree = _LARK.parse(dsl)
    except UnexpectedToken as e:
        col = getattr(e, "column", 1) or 1
        tok = getattr(e, "token", None)
        tok_str = str(tok) if tok is not None else ""
        raise DslError(
            type=ErrorType.unexpected_token,
            detail=f"unexpected token {tok_str!r} at column {col}",
            column=col,
            length=max(len(tok_str), 1),
        ) from e
    except UnexpectedCharacters as e:
        col = getattr(e, "column", 1) or 1
        raise DslError(
            type=ErrorType.unexpected_token, detail=f"unexpected character at column {col}", column=col, length=1
        ) from e
    except UnexpectedEOF as e:
        col = getattr(e, "column", len(dsl) + 1) or (len(dsl) + 1)
        raise DslError(
            type=ErrorType.unexpected_token, detail=f"unexpected end of query at column {col}", column=col, length=1
        ) from e
    except UnexpectedInput as e:
        col = getattr(e, "column", 1) or 1
        raise DslError(
            type=ErrorType.unexpected_token, detail=f"query parse error at column {col}", column=col, length=1
        ) from e
    except LarkError as e:
        raise DslError(type=ErrorType.unexpected_token, detail=f"query parse error: {e}", column=1, length=1) from e
    node: Any = _ToAst().transform(tree)
    if not isinstance(node, FreeText | FieldClause | BoolOp):
        raise DslError(type=ErrorType.unexpected_token, detail="query did not produce a valid AST", column=1, length=1)
    check_depth(node, MAX_DEPTH)
    return node
