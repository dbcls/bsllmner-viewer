"""Errors raised while parsing, validating, and compiling conditions."""

from __future__ import annotations

from enum import StrEnum


class ErrorType(StrEnum):
    unexpected_token = "unexpected-token"
    unknown_field = "unknown-field"
    invalid_date_format = "invalid-date-format"
    invalid_operator_for_field = "invalid-operator-for-field"
    invalid_value = "invalid-value"
    nest_depth_exceeded = "nest-depth-exceeded"
    missing_value = "missing-value"
    free_text_not_supported = "free-text-not-supported"
    invalid_ast = "invalid-ast"


class DslError(Exception):
    """A condition that cannot be parsed, validated, or evaluated."""

    def __init__(self, *, type: ErrorType, detail: str, column: int = 1, length: int = 0) -> None:
        super().__init__(detail)
        self.type = type
        self.detail = detail
        self.column = column
        self.length = length

    def __repr__(self) -> str:
        return f"DslError(type={self.type.value!r}, column={self.column}, length={self.length}, detail={self.detail!r})"
