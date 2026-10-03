from __future__ import annotations

import json
import random
import re
from collections.abc import Iterator

import duckdb
import pytest

from bsllmner_viewer.build.derive import _derive_searchable_text


def test_searchable_text_has_one_row_per_biosample_of_the_population(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    texts = store_con.execute("SELECT biosample FROM searchable_text").fetchall()
    population = store_con.execute("SELECT DISTINCT biosample FROM population").fetchall()
    assert sorted(texts) == sorted(population)
    assert len(texts) == len(set(texts))


def test_searchable_text_is_lower_case_with_single_spaces_and_padded(store_con: duckdb.DuckDBPyConnection) -> None:
    for biosample, text in store_con.execute("SELECT biosample, text FROM searchable_text").fetchall():
        assert text == text.lower(), biosample
        assert text.startswith(" "), biosample
        assert text.endswith(" "), biosample
        assert "  " not in text, biosample
        assert re.fullmatch(r"[a-z0-9| ]+", text), biosample


def test_searchable_text_holds_title_organism_description_attribute_values_and_annotation_values(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    accession, title, organism, description, attributes = store_con.execute(
        "SELECT accession, title, organism_name, description, attributes FROM biosample "
        "WHERE accession IN (SELECT biosample FROM searchable_text) AND description::VARCHAR LIKE '%Description%' "
        "ORDER BY accession LIMIT 1"
    ).fetchone()  # type: ignore[misc]
    text = store_con.execute("SELECT text FROM searchable_text WHERE biosample = ?", [accession]).fetchone()[0]  # type: ignore[index]
    described = [d["value"] for d in json.loads(description)]
    assert described
    values = [title, organism, *described, *(a["value"] for a in json.loads(attributes))]
    for value in values:
        words = " ".join(re.findall(r"[a-z0-9]+", value.lower()))
        assert f" {words} " in text
    assert " | ".join(re.sub(r"[^a-z0-9]+", " ", v.lower()).strip() for v in values[:2]) in text


def test_searchable_text_does_not_hold_attribute_names(store_con: duckdb.DuckDBPyConnection) -> None:
    names = {"sample_name", "cell_line", "chip_antigen"}
    for (text,) in store_con.execute("SELECT text FROM searchable_text").fetchall():
        for name in names:
            assert name not in text
            assert name.replace("_", " ") not in text


def test_searchable_text_holds_the_term_label_and_the_extracted_value_of_each_annotation(
    store_con: duckdb.DuckDBPyConnection,
) -> None:
    rows = store_con.execute(
        "SELECT a.biosample, a.extracted_value, a.term_label, s.text FROM annotation a "
        "JOIN searchable_text s ON s.biosample = a.biosample WHERE a.extracted_value IS NOT NULL"
    ).fetchall()
    assert rows
    for _, value, label, text in rows:
        for part in (value, label):
            if part:
                assert " " + " ".join(re.findall(r"[a-z0-9]+", part.lower())) + " " in text


def test_searchable_text_adds_the_joined_form_of_a_word_with_symbols(store_con: duckdb.DuckDBPyConnection) -> None:
    rows = store_con.execute(
        "SELECT s.text FROM biosample b JOIN searchable_text s ON s.biosample = b.accession "
        "WHERE b.attributes::VARCHAR LIKE '%MCF-7%'"
    ).fetchall()
    assert rows
    for (text,) in rows:
        assert " mcf 7 " in text
        assert " mcf7 " in " " + text.split(" | ")[-1] + " "


@pytest.fixture
def con() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect(":memory:")
    connection.execute(
        "CREATE TABLE biosample "
        "(accession VARCHAR, title VARCHAR, organism_name VARCHAR, description JSON, attributes JSON)"
    )
    connection.execute(
        "CREATE TABLE annotation "
        "(biosample VARCHAR, field VARCHAR, value_index INTEGER, extracted_value VARCHAR, term_label VARCHAR)"
    )
    connection.execute("CREATE TABLE population (biosample VARCHAR)")
    yield connection
    connection.close()


def _add(
    con: duckdb.DuckDBPyConnection,
    accession: str,
    *,
    title: str | None = None,
    organism: str | None = None,
    values: list[str] | None = None,
    annotations: list[tuple[str | None, str | None]] = (),  # type: ignore[assignment]
    in_population: bool = True,
    described: list[str] = (),  # type: ignore[assignment]
) -> None:
    attributes = None if values is None else json.dumps([{"name": "n", "value": v} for v in values])
    description = json.dumps([{"name": "Description", "value": v} for v in described])
    con.execute("INSERT INTO biosample VALUES (?, ?, ?, ?, ?)", [accession, title, organism, description, attributes])
    for index, (value, label) in enumerate(annotations):
        con.execute("INSERT INTO annotation VALUES (?, 'f', ?, ?, ?)", [accession, index, value, label])
    if in_population:
        con.execute("INSERT INTO population VALUES (?)", [accession])


def _texts(con: duckdb.DuckDBPyConnection) -> dict[str, str]:
    _derive_searchable_text(con)
    return dict(con.execute("SELECT biosample, text FROM searchable_text").fetchall())


def test_searchable_text_joins_values_with_a_bar_in_order(con: duckdb.DuckDBPyConnection) -> None:
    _add(
        con,
        "S1",
        title="Liver Biopsy",
        organism="Homo sapiens",
        values=["Sample 1", "treated"],
        annotations=[("hepatic", "liver")],
    )
    assert _texts(con)["S1"].startswith(" liver biopsy | homo sapiens | sample 1 | treated | hepatic | liver ")


def test_searchable_text_puts_the_description_between_the_organism_and_the_attributes(
    con: duckdb.DuckDBPyConnection,
) -> None:
    _add(con, "S1", title="T", organism="Mus musculus", values=["attr"], described=["Whsc1KO heart", "second"])
    assert _texts(con)["S1"].startswith(" t | mus musculus | whsc1ko heart | second | attr ")


def test_searchable_text_of_a_biosample_with_only_a_title(con: duckdb.DuckDBPyConnection) -> None:
    _add(con, "S1", title="Only Title")
    assert _texts(con)["S1"].strip(" |") == "only title"


def test_searchable_text_of_a_biosample_without_any_value_has_no_words(con: duckdb.DuckDBPyConnection) -> None:
    _add(con, "S1")
    text = _texts(con).get("S1", " ")
    assert re.sub(r"[ |]", "", text) == ""


def test_searchable_text_skips_a_null_value_without_dropping_the_others(con: duckdb.DuckDBPyConnection) -> None:
    _add(con, "S1", title=None, organism="Mus musculus", values=["a", "b"], annotations=[(None, "liver"), ("x", None)])
    text = _texts(con)["S1"]
    for word in ("mus musculus", "a", "b", "liver", "x"):
        assert f" {word} " in text


def test_searchable_text_leaves_out_a_biosample_that_is_not_in_the_population(con: duckdb.DuckDBPyConnection) -> None:
    _add(con, "IN", title="a")
    _add(con, "OUT", title="b", in_population=False)
    assert set(_texts(con)) == {"IN"}


def test_searchable_text_keeps_a_phrase_from_spanning_two_values(con: duckdb.DuckDBPyConnection) -> None:
    _add(con, "S1", title="breast", values=["cancer"])
    text = _texts(con)["S1"]
    assert " breast cancer " not in text
    assert " breast | " in text


def test_searchable_text_treats_a_bar_inside_a_value_as_a_separator_of_words(con: duckdb.DuckDBPyConnection) -> None:
    _add(con, "S1", values=["T|B cells"])
    text = _texts(con)["S1"]
    assert " t b cells " in text
    assert " tb " in text


@pytest.mark.parametrize(
    ("value", "joined"),
    [
        ("MCF-7", ["mcf7"]),
        ("IL-4/IL-13", ["il4il13"]),
        ("a-b-c", ["abc"]),
        ("HIF-1alpha, CD4+", ["hif1alpha"]),
        ("(K-562)", ["k562"]),
        ("TNF-\u03b1", []),
        ("plain words", []),
        ("CD4+", []),
        ("a - b", []),
    ],
)
def test_searchable_text_adds_the_joined_form_of_each_word_with_symbols_after_the_values(
    con: duckdb.DuckDBPyConnection, value: str, joined: list[str]
) -> None:
    _add(con, "S1", values=[value])
    text = _texts(con)["S1"]
    tail = text.rsplit(" | ", 1)[-1]
    assert [w for w in tail.split() if w in joined] == joined
    if not joined:
        assert " | " not in text.strip() or tail.strip() == ""


def test_searchable_text_keeps_a_phrase_from_spanning_two_joined_forms(con: duckdb.DuckDBPyConnection) -> None:
    _add(con, "S1", values=["MCF-7 IL-4"])
    text = _texts(con)["S1"]
    assert " mcf 7 il 4 " in text
    assert " mcf7 | il4 " in text
    assert " mcf7 il4 " not in text


def test_searchable_text_is_lower_case_for_every_value(con: duckdb.DuckDBPyConnection) -> None:
    _add(con, "S1", title="ABC Def", organism="GHI", values=["JKL"], annotations=[("MNO", "PQR")])
    text = _texts(con)["S1"]
    assert text == text.lower()
    assert " abc def | ghi | jkl | mno | pqr " in text


def test_searchable_text_treats_non_ascii_characters_as_separators(con: duckdb.DuckDBPyConnection) -> None:
    _add(con, "S1", values=["café au lait"])
    assert " caf au lait " in _texts(con)["S1"]


def test_searchable_text_of_a_biosample_with_a_null_attribute_list_still_holds_the_title(
    con: duckdb.DuckDBPyConnection,
) -> None:
    _add(con, "S1", title="t1", values=None)
    assert " t1 " in _texts(con)["S1"]


def test_searchable_text_of_a_biosample_with_an_empty_attribute_list_still_holds_the_title(
    con: duckdb.DuckDBPyConnection,
) -> None:
    _add(con, "S1", title="t1", values=[])
    assert " t1 " in _texts(con)["S1"]


def test_searchable_text_orders_annotation_values_by_field_and_value_index_whatever_the_row_order(
    con: duckdb.DuckDBPyConnection,
) -> None:
    con.execute("INSERT INTO biosample VALUES ('S1', NULL, NULL, '[]', NULL)")
    con.execute("INSERT INTO population VALUES ('S1')")
    keys = [(field, index) for field in ("a", "b", "c") for index in range(1000)]
    shuffled = random.Random(0).sample(keys, len(keys))
    con.executemany("INSERT INTO annotation VALUES ('S1', ?, ?, ?, NULL)", [(f, i, f"{f}{i:04d}") for f, i in shuffled])
    con.execute("SET threads = 4")
    expected = " | ".join(f"{f}{i:04d}" for f, i in keys)
    for _ in range(2):
        con.execute("DROP TABLE IF EXISTS searchable_text")
        assert expected in _texts(con)["S1"]
