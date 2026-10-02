from __future__ import annotations

import pytest

from bsllmner_viewer.dsl.ast import structurally_equal
from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serde import ast_to_json, json_to_ast

FIELDS = FieldSet(("disease",))


def test_ast_to_json_uses_op_discriminated_nodes() -> None:
    ast = parse('disease:"MONDO:1" AND NOT (disease_status:unmapped OR date_created:[2020-01-01 TO 2020-12-31])')
    assert ast_to_json(ast, FIELDS) == {
        "op": "AND",
        "rules": [
            {"field": "disease", "op": "eq", "value": "MONDO:1"},
            {
                "op": "NOT",
                "rules": [
                    {
                        "op": "OR",
                        "rules": [
                            {"field": "disease_status", "op": "eq", "value": "unmapped"},
                            {"field": "date_created", "op": "between", "from": "2020-01-01", "to": "2020-12-31"},
                        ],
                    }
                ],
            },
        ],
    }


def test_json_to_ast_infers_date_kind_for_date_eq() -> None:
    ast = json_to_ast({"field": "date_created", "op": "eq", "value": "2020-01-01"}, FIELDS)
    assert structurally_equal(ast, parse("date_created:2020-01-01"))


def test_json_round_trip_keeps_structure() -> None:
    ast = parse('(disease:"MONDO:1" OR disease:"MONDO:2") AND library_strategy:ATAC-seq')
    assert structurally_equal(json_to_ast(ast_to_json(ast, FIELDS), FIELDS), ast)


@pytest.mark.parametrize(
    "payload",
    [
        {"op": "XOR", "rules": []},
        {"op": "AND", "rules": []},
        {
            "op": "NOT",
            "rules": [{"field": "disease", "op": "eq", "value": "a"}, {"field": "disease", "op": "eq", "value": "b"}],
        },
        {"field": "disease", "op": "eq"},
        {"field": "disease", "op": "between", "from": "2020-01-01"},
        "disease:a",
    ],
)
def test_json_to_ast_rejects_malformed_trees(payload: object) -> None:
    with pytest.raises(DslError) as info:
        json_to_ast(payload, FIELDS)
    assert info.value.type is ErrorType.invalid_ast
