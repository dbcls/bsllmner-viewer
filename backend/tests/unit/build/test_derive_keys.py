"""The derived BioSamples, terms, experiments, and BioProjects have one row per key, however the raw tables repeat."""

from __future__ import annotations

import datetime

import duckdb
from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.build.derive import derive
from bsllmner_viewer.store.schema import create_raw_tables

BIOSAMPLES = ["SAMD1", "SAMD2", "SAMD3"]
TERMS = ["MONDO:1", "MONDO:2", "MONDO:3"]
# Terms that annotations name and that no ontology file has.
UNLISTED_TERMS = ["MONDO:8", "MONDO:9"]
EXPERIMENTS = ["SRX1", "SRX2", "SRX3"]
BIOPROJECTS = ["PRJNA1", "PRJNA2", "PRJNA3"]
STRATEGIES = ["RNA-Seq", "ChIP-Seq", None]

entries = st.sets(st.tuples(st.sampled_from([1, 2]), st.sampled_from(BIOSAMPLES)), min_size=1)
ref_terms = st.lists(st.tuples(st.sampled_from(TERMS), st.integers(0, 2), st.sampled_from(["a", "b", None])))
annotation_terms = st.lists(st.sampled_from([*TERMS, *UNLISTED_TERMS, None]), max_size=6)
ref_experiments = st.lists(st.tuples(st.sampled_from(EXPERIMENTS), st.sampled_from(STRATEGIES)))
links = st.lists(st.tuples(st.sampled_from(BIOSAMPLES), st.sampled_from(EXPERIMENTS)))
ref_bioprojects = st.lists(st.tuples(st.sampled_from(BIOPROJECTS), st.sampled_from(["x", "y", None])))
project_links = st.lists(st.tuples(st.sampled_from(BIOSAMPLES), st.sampled_from(BIOPROJECTS)))


def _raw(
    entry_keys: set[tuple[int, str]],
    terms: list[tuple[str, int, str | None]],
    annotated: list[str | None],
    experiments: list[tuple[str, str | None]],
    experiment_links: list[tuple[str, str]],
    bioprojects: list[tuple[str, str | None]],
    bioproject_links: list[tuple[str, str]],
) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    create_raw_tables(con)
    now = datetime.datetime(2026, 1, 1)
    for run_id in (1, 2):
        con.execute(
            "INSERT INTO run VALUES (?, ?, ?, 'r.json', 'i.jsonl', 'c.json', 'sha', 'v', 'model', 0, ?)",
            [run_id, run_id - 1, f"run{run_id}", now],
        )
    con.execute("INSERT INTO field VALUES ('disease', 0, TRUE, ['mondo.obo'])")
    for run_id, accession in sorted(entry_keys):
        con.execute(
            "INSERT INTO entry VALUES (?, ?, 9606, 'Homo sapiens', 't', DATE '2020-01-01', '[]', '[]', '[]')",
            [run_id, accession],
        )
        for value_index, term_id in enumerate(annotated):
            con.execute(
                "INSERT INTO entry_annotation VALUES (?, ?, 'disease', ?, 'v', ?, ?, ?)",
                [run_id, accession, value_index, "unmapped" if term_id is None else "mapped_exact", term_id, term_id],
            )
    for sql, rows in (
        ("INSERT INTO ref_term VALUES (?, 'MONDO', ?, ?)", terms),
        ("INSERT INTO ref_experiment VALUES (?, ?)", experiments),
        ("INSERT INTO ref_biosample_experiment VALUES (?, ?)", experiment_links),
        ("INSERT INTO ref_bioproject VALUES (?, ?)", bioprojects),
        ("INSERT INTO ref_biosample_bioproject VALUES (?, ?)", bioproject_links),
    ):
        for row in rows:
            con.execute(sql, list(row))
    return con


@given(entries, ref_terms, annotation_terms, ref_experiments, links, ref_bioprojects, project_links)
def test_the_derived_biosamples_terms_experiments_and_bioprojects_have_one_row_per_key(
    entry_keys: set[tuple[int, str]],
    terms: list[tuple[str, int, str | None]],
    annotated: list[str | None],
    experiments: list[tuple[str, str | None]],
    experiment_links: list[tuple[str, str]],
    bioprojects: list[tuple[str, str | None]],
    bioproject_links: list[tuple[str, str]],
) -> None:
    con = _raw(entry_keys, terms, annotated, experiments, experiment_links, bioprojects, bioproject_links)
    derive(con, ["RNA-Seq", "ChIP-Seq"])
    keys = (("biosample", "accession"), ("term", "term_id"), ("experiment", "accession"), ("bioproject", "accession"))
    for table, key in keys:
        rows, distinct = con.execute(f"SELECT count(*), count(DISTINCT {key}) FROM {table}").fetchone()  # type: ignore[misc]
        assert rows == distinct, table
    assert {r[0] for r in con.execute("SELECT accession FROM biosample").fetchall()} == {a for _, a in entry_keys}
    listed = {t for t, _, _ in terms}
    unlisted = {t for t in annotated if t is not None and t not in listed}
    assert {r[0] for r in con.execute("SELECT term_id FROM term").fetchall()} == listed | unlisted
