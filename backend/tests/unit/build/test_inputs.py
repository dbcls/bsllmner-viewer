from __future__ import annotations

import datetime
import json
from pathlib import Path

import pytest

from bsllmner_viewer.build.inputs import parse_datetime, parse_input_doc, plausible_publication_date, read_input


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
    assert parsed.date_published == datetime.date(2025, 1, 6)
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
    assert parsed.date_published == datetime.date(2013, 1, 6)
    assert [a.name for a in parsed.attributes] == ["sample_name"]


def test_parse_input_doc_without_attributes_or_dates() -> None:
    parsed = parse_input_doc({"accession": "SAMN1", "Attributes": None})
    assert parsed.attributes == []
    assert parsed.date_published is None
    assert parsed.organism_id is None


def test_parse_input_doc_without_publication_date_has_no_date_even_with_other_dates() -> None:
    parsed = parse_input_doc(
        {
            "accession": "SAMN1",
            "submission_date": "2024-12-30T10:00:00",
            "last_update": "2025-01-06T23:03:24.000+09:00",
        }
    )
    assert parsed.date_published is None


def test_parse_input_doc_converts_the_publication_date_to_utc() -> None:
    assert parse_input_doc({"accession": "SAMN1", "publication_date": "2025-01-06T08:00:00+09:00"}).date_published == (
        datetime.date(2025, 1, 5)
    )
    assert parse_input_doc({"accession": "SAMN1", "publication_date": "2025-01-06T23:30:00-02:00"}).date_published == (
        datetime.date(2025, 1, 7)
    )


def test_parse_input_doc_keeps_a_future_publication_date() -> None:
    assert parse_input_doc({"accession": "SAMN1", "publication_date": "2999-01-01T00:00:00Z"}).date_published == (
        datetime.date(2999, 1, 1)
    )


RUN_START = datetime.datetime(2026, 6, 3, 3, 23, tzinfo=datetime.UTC)
JST = datetime.timezone(datetime.timedelta(hours=9))


@pytest.mark.parametrize(
    ("published", "run_start", "expected"),
    [
        (None, RUN_START, None),
        (datetime.date(2000, 1, 1), RUN_START, None),
        (datetime.date(2004, 12, 31), RUN_START, None),
        (datetime.date(2005, 1, 1), RUN_START, datetime.date(2005, 1, 1)),
        (datetime.date(2026, 6, 3), RUN_START, datetime.date(2026, 6, 3)),
        (datetime.date(2026, 6, 4), RUN_START, None),
        (datetime.date(3000, 1, 1), RUN_START, None),
        (datetime.date(2026, 6, 3), datetime.datetime(2026, 6, 3, 1, 0, tzinfo=JST), None),
        (datetime.date(2026, 6, 3), datetime.datetime(2026, 6, 3, 3, 23), datetime.date(2026, 6, 3)),
        (datetime.date(2004, 12, 31), None, None),
        (datetime.date(3000, 1, 1), None, datetime.date(3000, 1, 1)),
    ],
)
def test_plausible_publication_date_keeps_only_dates_from_2005_to_the_utc_day_the_run_started(
    published: datetime.date | None, run_start: datetime.datetime | None, expected: datetime.date | None
) -> None:
    assert plausible_publication_date(published, run_start) == expected


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


def test_read_input_reads_both_shapes_from_one_file(tmp_path: Path) -> None:
    wrapped = {
        "BioSample": {
            "submission_date": "2024-12-30T10:00:00",
            "Description": {"Title": "wrapped", "Organism": {"taxonomy_id": "9606"}},
            "Attributes": {"Attribute": [{"attribute_name": "tissue", "content": "colon"}]},
        },
        "accession": "SAMN1",
    }
    flat = {
        "accession": "SAMN2",
        "publication_date": "2013-01-07T00:00:00+09:00",
        "Description": {"Title": "flat", "Organism": {"taxonomy_id": "10090"}},
        "Attributes": {"Attribute": {"attribute_name": "sample_name", "content": "x"}},
    }
    path = tmp_path / "mixed.jsonl"
    path.write_text("\n".join(json.dumps(d) for d in (wrapped, flat, wrapped | {"accession": "SAMN3"})) + "\n\n")
    docs = list(read_input(path))
    assert [(d.accession, d.title, d.organism_id) for d in docs] == [
        ("SAMN1", "wrapped", 9606),
        ("SAMN2", "flat", 10090),
        ("SAMN3", "wrapped", 9606),
    ]
    assert [[a.name for a in d.attributes] for d in docs] == [["tissue"], ["sample_name"], ["tissue"]]


def test_parse_input_doc_prefers_the_wrapped_entry_over_top_level_members() -> None:
    doc = {
        "BioSample": {"Description": {"Title": "inner", "Organism": {"taxonomy_id": "9606"}}},
        "Description": {"Title": "outer", "Organism": {"taxonomy_id": "10090"}},
        "accession": "SAMN1",
    }
    parsed = parse_input_doc(doc)
    assert (parsed.title, parsed.organism_id) == ("inner", 9606)
