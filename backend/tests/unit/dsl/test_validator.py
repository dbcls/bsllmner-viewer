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
        "disease_status:mapped",
        "library_strategy:ATAC-seq",
        "organism_id:9606",
        "date_published:[2015-01-01 TO 2020-12-31]",
        "date_published:2016-02-29",
        "bioproject:PRJNA123456",
        '"breast cancer" AND hypoxia',
        "IL-4 OR NOT SRX0000001",
        'NOT disease:"MONDO:1" AND (tissue:"UBERON:1" OR tissue_status:no_value)',
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
        ('disease:"MONDO:1" OR NOT ".."', ErrorType.invalid_value),
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
        ("disease_status:bogus", ErrorType.invalid_value),
        ("disease_status:mapped_exact", ErrorType.invalid_value),
        ("disease_status:mapped_selected", ErrorType.invalid_value),
        ("disease_status:unmapped_no_candidate", ErrorType.invalid_value),
        ("disease_status:unmapped_rejected", ErrorType.invalid_value),
        ("disease_status:not_stated", ErrorType.invalid_value),
        ("disease_status:extraction_failed", ErrorType.invalid_value),
        ("disease_status:Mapped", ErrorType.invalid_value),
        ("organism_id:human", ErrorType.invalid_value),
        ("organism_id:\u0669\u0666\u0660\u0666", ErrorType.invalid_value),
        ("organism_id:\uff19\uff16\uff10\uff16", ErrorType.invalid_value),
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
        validate(parse('disease:"MONDO:1" AND --'), FIELDS)
    assert info.value.type is ErrorType.invalid_value
    assert info.value.column == 23


def test_validate_counts_keywords_as_nodes() -> None:
    dsl = " OR ".join(f"w{i}" for i in range(60))
    with pytest.raises(DslError) as info:
        validate(parse(dsl), FIELDS, max_nodes=50)
    assert info.value.type is ErrorType.nest_depth_exceeded


@pytest.mark.parametrize(
    "value",
    ["09606", "0009606", "+9606", "-1", "\uff19\uff16\uff10\uff16", "9_606", "2147483648", "9" * 39, "9" * 4000],
)
def test_validate_rejects_organism_ids_that_are_not_canonical(value: str) -> None:
    with pytest.raises(DslError) as info:
        validate(parse(f'organism_id:"{value}"'), FIELDS)
    assert info.value.type is ErrorType.invalid_value
    assert "leading zero" in info.value.detail


def test_validate_accepts_the_largest_organism_id() -> None:
    validate(parse("organism_id:2147483647"), FIELDS)


def test_validate_status_error_lists_the_accepted_groups() -> None:
    with pytest.raises(DslError) as info:
        validate(parse("disease_status:not_stated"), FIELDS)
    for group in ("mapped", "unmapped", "no_value"):
        assert group in info.value.detail


ASSAY_FIELDS = FieldSet(("disease", "tissue"), target_assays=("RNA-Seq", "ChIP-Seq"))


@pytest.mark.parametrize("value", ["RNA-Seq", "ChIP-Seq", '"RNA-Seq"'])
def test_validate_accepts_a_target_assay(value: str) -> None:
    validate(parse(f"library_strategy:{value}"), ASSAY_FIELDS)


@pytest.mark.parametrize("value", ["rna-seq", "RNA-seq", "ATAC-seq", "WGS", "RNA", '"RNA-Seq "'])
def test_validate_rejects_a_library_strategy_that_is_not_a_target_assay_and_lists_the_assays(value: str) -> None:
    with pytest.raises(DslError) as info:
        validate(parse(f"library_strategy:{value}"), ASSAY_FIELDS)
    assert info.value.type is ErrorType.invalid_value
    assert "RNA-Seq" in info.value.detail
    assert "ChIP-Seq" in info.value.detail


@pytest.mark.parametrize(
    "value", ["brain", "UBERON", '"UBERON:"', '":0000955"', '"UBERON 0000955"', '"brain tissue"', '"UBERON: 1"']
)
def test_validate_rejects_a_term_value_that_is_not_a_prefixed_id_and_points_to_the_term_search(value: str) -> None:
    with pytest.raises(DslError) as info:
        validate(parse(f"tissue:{value}"), FIELDS)
    assert info.value.type is ErrorType.invalid_value
    assert "GET /api/terms" in info.value.detail


@pytest.mark.parametrize("value", ['"UBERON:0000955"', '"NCBIGene:7157"', '"CVCL:R965"', '"MONDO:9999999"'])
def test_validate_accepts_a_well_formed_term_id_even_when_it_is_unknown(value: str) -> None:
    validate(parse(f"tissue:{value}"), FIELDS)
