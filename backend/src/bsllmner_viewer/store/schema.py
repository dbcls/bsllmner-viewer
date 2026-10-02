"""Store schema.

Raw tables persist what build read (runs, entries, reference data). Derived tables are recomputed from
the raw tables by every build operation and are the only tables the api reads for queries.
"""

from __future__ import annotations

import duckdb

SCHEMA_VERSION = 2

RAW_TABLES: tuple[str, ...] = (
    "store_meta",
    "run",
    "field",
    "entry",
    "entry_annotation",
    "ref_ontology",
    "ref_term",
    "ref_term_synonym",
    "ref_term_parent",
    "ref_experiment",
    "ref_biosample_experiment",
    "ref_experiment_run",
    "ref_biosample_bioproject",
    "ref_bioproject",
    "ref_chip_atlas",
)

DERIVED_TABLES: tuple[str, ...] = (
    "biosample",
    "annotation",
    "term",
    "term_synonym",
    "term_parent",
    "term_closure",
    "annotation_closure",
    "experiment",
    "biosample_experiment",
    "sra_run",
    "bioproject",
    "biosample_bioproject",
    "chip_atlas",
    "record",
    "field_term_count",
    "term_search",
    "field_status_count",
    "population_count",
)

_RAW_DDL = """
CREATE TABLE store_meta (key VARCHAR PRIMARY KEY, value JSON NOT NULL);

CREATE TABLE run (
    run_id INTEGER PRIMARY KEY,
    manifest_index INTEGER NOT NULL,
    name VARCHAR NOT NULL UNIQUE,
    result_file VARCHAR NOT NULL,
    input_file VARCHAR NOT NULL,
    select_config_file VARCHAR NOT NULL,
    select_config_sha256 VARCHAR NOT NULL,
    mk2_version VARCHAR NOT NULL,
    model VARCHAR NOT NULL,
    entry_count INTEGER NOT NULL,
    ingested_at TIMESTAMP NOT NULL
);

CREATE TABLE field (
    name VARCHAR PRIMARY KEY,
    position INTEGER NOT NULL,
    multi_valued BOOLEAN NOT NULL,
    ontology_files VARCHAR[] NOT NULL
);

CREATE TABLE entry (
    run_id INTEGER NOT NULL,
    accession VARCHAR NOT NULL,
    organism_id INTEGER,
    organism_name VARCHAR,
    title VARCHAR,
    date_created DATE,
    date_modified TIMESTAMP,
    attributes JSON NOT NULL
);

CREATE TABLE entry_annotation (
    run_id INTEGER NOT NULL,
    accession VARCHAR NOT NULL,
    field VARCHAR NOT NULL,
    value_index INTEGER NOT NULL,
    extracted_value VARCHAR,
    status VARCHAR NOT NULL,
    term_id VARCHAR,
    term_label VARCHAR
);

CREATE TABLE ref_ontology (
    name VARCHAR PRIMARY KEY,
    files VARCHAR[] NOT NULL,
    checksums VARCHAR[] NOT NULL,
    snapshot_date VARCHAR
);

CREATE TABLE ref_term (
    term_id VARCHAR NOT NULL,
    ontology VARCHAR NOT NULL,
    source_index INTEGER NOT NULL,
    label VARCHAR
);

CREATE TABLE ref_term_synonym (term_id VARCHAR NOT NULL, synonym VARCHAR NOT NULL);
CREATE TABLE ref_term_parent (term_id VARCHAR NOT NULL, parent_id VARCHAR NOT NULL);

CREATE TABLE ref_experiment (accession VARCHAR NOT NULL, library_strategy VARCHAR);
CREATE TABLE ref_biosample_experiment (biosample VARCHAR NOT NULL, experiment VARCHAR NOT NULL);
CREATE TABLE ref_experiment_run (experiment VARCHAR NOT NULL, run VARCHAR NOT NULL);
CREATE TABLE ref_biosample_bioproject (biosample VARCHAR NOT NULL, bioproject VARCHAR NOT NULL);
CREATE TABLE ref_bioproject (accession VARCHAR NOT NULL, title VARCHAR);
CREATE TABLE ref_chip_atlas (experiment VARCHAR NOT NULL, assembly VARCHAR NOT NULL);
"""


def create_raw_tables(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(_RAW_DDL)
    con.execute("INSERT INTO store_meta VALUES ('schema_version', ?)", [str(SCHEMA_VERSION)])


def drop_derived_tables(con: duckdb.DuckDBPyConnection) -> None:
    for table in DERIVED_TABLES:
        con.execute(f"DROP TABLE IF EXISTS {table}")


def copy_raw_tables(con: duckdb.DuckDBPyConnection, source_alias: str) -> None:
    """Copy every raw table from an attached store into the connection's default database."""
    for table in RAW_TABLES:
        con.execute(f"INSERT INTO {table} SELECT * FROM {source_alias}.{table}")
