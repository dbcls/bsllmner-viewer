from __future__ import annotations

import pytest

from bsllmner_viewer.dsl.errors import DslError, ErrorType
from bsllmner_viewer.dsl.fields import FieldSet
from bsllmner_viewer.dsl.parser import parse
from bsllmner_viewer.dsl.validator import validate

FIELDS = FieldSet(("disease", "tissue"))


@pytest.mark.parametrize(
    "dsl",
    [
        'disease:"MONDO:0007254"',
        "disease_value:breast",
        "disease_status:unmapped",
        "disease_status:mapped_exact",
        "library_strategy:ATAC-seq",
        "organism_id:9606",
        "date_created:[2015-01-01 TO 2020-12-31]",
        "date_created:2016-02-29",
        "bioproject:PRJNA123456",
        "identifier:SAMN00000001",
        "title:tumor",
        'NOT disease:"MONDO:1" AND (tissue_value:liver OR tissue_status:no_value)',
    ],
)
def test_validate_accepts_documented_field_examples(dsl: str) -> None:
    validate(parse(dsl), FIELDS)


@pytest.mark.parametrize(
    ("dsl", "error"),
    [
        ("cancer", ErrorType.free_text_not_supported),
        ('"Homo sapiens"', ErrorType.free_text_not_supported),
        ("cancer AND disease:x", ErrorType.free_text_not_supported),
        ("cell_line:x", ErrorType.unknown_field),
        ("disease_count:x", ErrorType.unknown_field),
        ("title:HIF-1*", ErrorType.invalid_operator_for_field),
        ("disease:[a TO b]", ErrorType.invalid_operator_for_field),
        ("date_created:2020", ErrorType.invalid_operator_for_field),
        ("date_created:[2020-01-01 TO x]", ErrorType.invalid_date_format),
        ("date_created:2021-02-29", ErrorType.invalid_date_format),
        ("date_created:[2021-01-01 TO 2020-01-01]", ErrorType.invalid_value),
        ("disease_status:bogus", ErrorType.invalid_value),
        ("organism_id:human", ErrorType.invalid_value),
        ('title:""', ErrorType.missing_value),
    ],
)
def test_validate_rejects_invalid_conditions(dsl: str, error: ErrorType) -> None:
    with pytest.raises(DslError) as info:
        validate(parse(dsl), FIELDS)
    assert info.value.type is error


def test_validate_rejects_deep_nesting() -> None:
    dsl = "disease:a"
    for _ in range(6):
        dsl = f"NOT ({dsl} AND tissue:b)"
    with pytest.raises(DslError) as info:
        validate(parse(dsl), FIELDS)
    assert info.value.type is ErrorType.nest_depth_exceeded


def test_validate_rejects_too_many_nodes() -> None:
    dsl = " OR ".join(f"disease:t{i}" for i in range(60))
    with pytest.raises(DslError) as info:
        validate(parse(dsl), FIELDS, max_nodes=50)
    assert info.value.type is ErrorType.nest_depth_exceeded
