from __future__ import annotations

import datetime

import pytest

from bsllmner_viewer.build.inputs import parse_datetime, parse_input_doc


def test_parse_input_doc_reads_wrapped_shape() -> None:
    doc = {
        "BioSample": {
            "last_update": "2025-01-06T23:03:24.000+09:00",
            "publication_date": "2025-01-06T23:03:24.000+09:00",
            "submission_date": "2024-12-30T10:00:00",
            "Ids": {"Id": {"namespace": "BioSample", "content": "SAMD00571058"}},
            "Description": {"Title": "HCT116", "Organism": {"taxonomy_id": "9606", "OrganismName": "Homo sapiens"}},
            "Attributes": {
                "Attribute": [{"attribute_name": "tissue", "content": "colon", "harmonized_name": "tissue"}]
            },
        },
        "accession": "SAMD00571058",
    }
    parsed = parse_input_doc(doc)
    assert parsed.accession == "SAMD00571058"
    assert parsed.organism_id == 9606
    assert parsed.organism_name == "Homo sapiens"
    assert parsed.title == "HCT116"
    assert parsed.date_created == datetime.date(2024, 12, 30)
    assert parsed.date_modified == datetime.datetime(2025, 1, 6, 14, 3, 24)
    assert [(a.name, a.value, a.harmonized_name) for a in parsed.attributes] == [("tissue", "colon", "tissue")]


def test_parse_input_doc_reads_flat_shape_and_single_attribute() -> None:
    doc = {
        "publication_date": "2013-01-07T00:00:00+09:00",
        "last_update": "2014-11-12T17:28:52+09:00",
        "Description": {"Organism": {"taxonomy_id": "10090", "taxonomy_name": "Mus musculus"}},
        "Attributes": {"Attribute": {"attribute_name": "sample_name", "content": "x"}},
        "accession": "SAMD00004141",
    }
    parsed = parse_input_doc(doc)
    assert parsed.organism_id == 10090
    assert parsed.organism_name == "Mus musculus"
    assert parsed.title is None
    assert parsed.date_created == datetime.date(2013, 1, 6)
    assert [a.name for a in parsed.attributes] == ["sample_name"]


def test_parse_input_doc_without_attributes_or_dates() -> None:
    parsed = parse_input_doc({"accession": "SAMN1", "Attributes": None})
    assert parsed.attributes == []
    assert parsed.date_created is None
    assert parsed.date_modified is None
    assert parsed.organism_id is None


def test_parse_input_doc_requires_accession() -> None:
    with pytest.raises(ValueError, match="accession"):
        parse_input_doc({"BioSample": {}})


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2021-03-05T02:11:27Z", datetime.datetime(2021, 3, 5, 2, 11, 27)),
        ("2018-11-27T16:18:18.683", datetime.datetime(2018, 11, 27, 16, 18, 18, 683000)),
        ("not a date", None),
        (None, None),
        (12, None),
    ],
)
def test_parse_datetime_normalizes_to_naive_utc(value: object, expected: datetime.datetime | None) -> None:
    assert parse_datetime(value) == expected
