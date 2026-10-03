from __future__ import annotations

from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.serde import ast_to_json

FIELDS = FieldSet(("disease",))


def test_ast_to_json_uses_op_discriminated_nodes() -> None:
    ast = parse('disease:"MONDO:1" AND NOT (disease_status:unmapped OR date_published:[2020-01-01 TO 2020-12-31])')
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
                            {"field": "date_published", "op": "between", "from": "2020-01-01", "to": "2020-12-31"},
                        ],
                    }
                ],
            },
        ],
    }
