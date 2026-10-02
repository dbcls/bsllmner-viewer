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
        "disease_status:unmapped",
        "disease_status:mapped_exact",
        "library_strategy:ATAC-seq",
        "organism_id:9606",
        "date_published:[2015-01-01 TO 2020-12-31]",
        "date_published:2016-02-29",
        "bioproject:PRJNA123456",
        '"breast cancer" AND hypoxia',
        "IL-4 OR NOT SRX0000001",
        'NOT disease:"MONDO:1" AND (tissue:liver OR tissue_status:no_value)',
    ],
)
def test_validate_accepts_documented_field_examples(dsl: str) -> None:
    validate(parse(dsl), FIELDS)


@pytest.mark.parametrize(
    ("dsl", "error"),
    [
        ("--", ErrorType.invalid_value),
        ('"+ -"', ErrorType.invalid_value),
        ("cancer AND ---", ErrorType.invalid_value),
        ('disease:x OR NOT ".."', ErrorType.invalid_value),
        ("disease_value:x", ErrorType.unknown_field),
        ("title:x", ErrorType.unknown_field),
        ("identifier:SAMN1", ErrorType.unknown_field),
        ("cell_line:x", ErrorType.unknown_field),
        ("disease_count:x", ErrorType.unknown_field),
        ("disease:HIF-1*", ErrorType.invalid_operator_for_field),
        ("disease:[a TO b]", ErrorType.invalid_operator_for_field),
        ("date_published:2020", ErrorType.invalid_operator_for_field),
        ("date_published:[2020-01-01 TO x]", ErrorType.invalid_date_format),
        ("date_published:2021-02-29", ErrorType.invalid_date_format),
        ("date_published:[2021-01-01 TO 2020-01-01]", ErrorType.invalid_value),
        ("disease_status:bogus", ErrorType.invalid_value),
        ("organism_id:human", ErrorType.invalid_value),
        ('disease:""', ErrorType.missing_value),
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


@pytest.mark.parametrize(
    "dsl",
    [
        "hypoxia",
        "IL-4",
        "CD4+",
        "SAMN1",
        '"a b"',
        "a OR b",
        "NOT hypoxia",
        'disease:"MONDO:1" AND NOT (hypoxia OR "breast cancer")',
        "7",
        "+7",
    ],
)
def test_validate_accepts_keywords_anywhere_in_a_condition(dsl: str) -> None:
    validate(parse(dsl), FIELDS)


def test_validate_reports_the_column_of_a_keyword_without_a_letter_or_a_digit() -> None:
    with pytest.raises(DslError) as info:
        validate(parse("disease:x AND --"), FIELDS)
    assert info.value.type is ErrorType.invalid_value
    assert info.value.column == 15


def test_validate_counts_keywords_as_nodes() -> None:
    dsl = " OR ".join(f"w{i}" for i in range(60))
    with pytest.raises(DslError) as info:
        validate(parse(dsl), FIELDS, max_nodes=50)
    assert info.value.type is ErrorType.nest_depth_exceeded
