"""Derivation of query-ready tables from the raw tables."""

from __future__ import annotations

import duckdb

from bsllmner_viewer.api.queries.evidence import find_spans
from bsllmner_viewer.build.mk2_filter_keys import MK2_FILTER_KEYS
from bsllmner_viewer.dsl.fields import STATUS_GROUPS
from bsllmner_viewer.store.organisms import ORGANISM_NAMES
from bsllmner_viewer.store.schema import drop_derived_tables

_ATTRIBUTES = '[{"name": "VARCHAR", "value": "VARCHAR", "harmonized_name": "VARCHAR"}]'
_FETCH_ROWS = 10_000


def derive(con: duckdb.DuckDBPyConnection, target_assays: list[str]) -> None:
    drop_derived_tables(con)
    con.execute(
        """
        CREATE TABLE biosample AS
        SELECT e.accession, e.run_id, e.organism_id, e.organism_name, e.title, e.date_published, e.attributes,
               e.description, e.record
        FROM entry e JOIN run r USING (run_id)
        QUALIFY row_number() OVER (
            PARTITION BY e.accession ORDER BY r.manifest_index
        ) = 1
        ORDER BY e.accession
        """
    )
    con.execute(
        """
        CREATE TABLE annotation AS
        SELECT a.accession AS biosample, a.field, a.value_index, a.extracted_value, a.status, a.term_id, a.term_label
        FROM entry_annotation a JOIN biosample b ON a.accession = b.accession AND a.run_id = b.run_id
        ORDER BY a.field, a.status, a.accession
        """
    )
    _omit_attributes(con)
    con.execute("CREATE UNIQUE INDEX biosample_accession ON biosample (accession)")
    con.execute(
        """
        CREATE TABLE term AS
        SELECT term_id, split_part(term_id, ':', 1) AS ontology, label, TRUE AS in_reference
        FROM (
            SELECT term_id, arg_min(label, source_index) AS label
            FROM ref_term GROUP BY term_id
        )
        UNION ALL
        SELECT term_id, split_part(term_id, ':', 1) AS ontology, arg_min(term_label, biosample) AS label, FALSE
        FROM annotation
        WHERE term_id IS NOT NULL AND term_id NOT IN (SELECT term_id FROM ref_term)
        GROUP BY term_id
        ORDER BY term_id
        """
    )
    con.execute("CREATE UNIQUE INDEX term_term_id ON term (term_id)")
    con.execute(
        """
        CREATE TABLE term_synonym AS
        SELECT DISTINCT term_id, synonym FROM ref_term_synonym WHERE term_id IN (SELECT term_id FROM term)
        ORDER BY term_id
        """
    )
    con.execute(
        """
        CREATE TABLE term_parent AS
        SELECT DISTINCT term_id, parent_id FROM ref_term_parent
        WHERE term_id IN (SELECT term_id FROM term) AND parent_id IN (SELECT term_id FROM term) AND term_id <> parent_id
        ORDER BY term_id
        """
    )
    con.execute(
        """
        CREATE TABLE term_closure AS
        WITH RECURSIVE up(descendant, ancestor, depth) AS (
            SELECT term_id, term_id, 0 FROM term
            UNION
            SELECT up.descendant, p.parent_id, up.depth + 1
            FROM up JOIN term_parent p ON p.term_id = up.ancestor
            WHERE up.depth < 64
        )
        SELECT ancestor, descendant, min(depth) AS depth FROM up GROUP BY ancestor, descendant
        ORDER BY ancestor, descendant
        """
    )
    con.execute(
        """
        CREATE TABLE annotation_closure AS
        SELECT DISTINCT a.biosample, a.field, c.ancestor
        FROM annotation a JOIN term_closure c ON c.descendant = a.term_id
        ORDER BY field, ancestor, biosample
        """
    )
    con.execute(
        """
        CREATE TABLE biosample_experiment AS
        SELECT DISTINCT biosample, experiment FROM ref_biosample_experiment
        WHERE biosample IN (SELECT accession FROM biosample)
        ORDER BY biosample, experiment
        """
    )
    con.execute(
        """
        CREATE TABLE experiment AS
        SELECT x.experiment AS accession, arg_min(r.library_strategy, r.library_strategy) AS library_strategy
        FROM (SELECT DISTINCT experiment FROM biosample_experiment) x
        LEFT JOIN ref_experiment r ON r.accession = x.experiment
        GROUP BY x.experiment
        ORDER BY x.experiment
        """
    )
    con.execute("CREATE UNIQUE INDEX experiment_accession ON experiment (accession)")
    con.execute(
        """
        CREATE TABLE sra_run AS
        SELECT DISTINCT run AS accession, experiment FROM ref_experiment_run
        WHERE experiment IN (SELECT accession FROM experiment)
        ORDER BY experiment, run
        """
    )
    con.execute(
        """
        CREATE TABLE biosample_bioproject AS
        SELECT DISTINCT biosample, bioproject FROM ref_biosample_bioproject
        WHERE biosample IN (SELECT accession FROM biosample)
        ORDER BY biosample, bioproject
        """
    )
    con.execute(
        """
        CREATE TABLE bioproject AS
        SELECT x.bioproject AS accession, arg_min(r.title, r.title) AS title
        FROM (SELECT DISTINCT bioproject FROM biosample_bioproject) x
        LEFT JOIN ref_bioproject r ON r.accession = x.bioproject
        GROUP BY x.bioproject
        ORDER BY x.bioproject
        """
    )
    con.execute("CREATE UNIQUE INDEX bioproject_accession ON bioproject (accession)")
    con.execute(
        """
        CREATE TABLE chip_atlas AS
        SELECT DISTINCT experiment, assembly FROM ref_chip_atlas
        WHERE experiment IN (SELECT accession FROM experiment)
        ORDER BY experiment, assembly
        """
    )
    placeholders = ", ".join("?" for _ in target_assays)
    con.execute(
        f"""
        CREATE TABLE population AS
        SELECT be.biosample, be.experiment, e.library_strategy, b.organism_id, b.date_published,
               year(b.date_published) AS year
        FROM biosample_experiment be
        JOIN experiment e ON e.accession = be.experiment
        JOIN biosample b ON b.accession = be.biosample
        WHERE e.library_strategy IN ({placeholders})
        ORDER BY be.biosample, be.experiment
        """,
        target_assays,
    )
    _derive_searchable_text(con)
    con.execute(
        """
        CREATE TABLE field_term_count AS
        WITH expanded AS (
            SELECT ac.field, ac.ancestor AS term_id,
                   count(DISTINCT pn.biosample) AS n_biosample,
                   count(DISTINCT pn.experiment) AS n_experiment,
                   count(DISTINCT bp.bioproject) AS n_bioproject
            FROM population pn
            JOIN annotation_closure ac ON ac.biosample = pn.biosample
            LEFT JOIN biosample_bioproject bp ON bp.biosample = pn.biosample
            GROUP BY ac.field, ac.ancestor
        ),
        direct AS (
            SELECT a.field, a.term_id, count(DISTINCT pn.biosample) AS n_direct
            FROM population pn JOIN annotation a ON a.biosample = pn.biosample
            WHERE a.term_id IS NOT NULL
            GROUP BY a.field, a.term_id
        )
        SELECT e.field, e.term_id, e.n_biosample, e.n_experiment, e.n_bioproject, coalesce(d.n_direct, 0) AS n_direct
        FROM expanded e LEFT JOIN direct d ON d.field = e.field AND d.term_id = e.term_id
        ORDER BY e.field, n_direct DESC, e.n_biosample DESC, e.term_id
        """
    )
    con.execute(
        """
        CREATE TABLE term_search AS
        SELECT DISTINCT c.field, c.term_id, x.text
        FROM field_term_count c
        JOIN (
            SELECT term_id, lower(label) AS text FROM term WHERE label IS NOT NULL
            UNION ALL
            SELECT term_id, lower(term_id) AS text FROM term
            UNION ALL
            SELECT term_id, lower(synonym) AS text FROM term_synonym
        ) x ON x.term_id = c.term_id
        ORDER BY c.field, c.term_id
        """
    )
    con.execute(
        """
        CREATE TABLE field_status_count AS
        SELECT a.field, a.status,
               count(DISTINCT pn.biosample) AS n_biosample,
               count(DISTINCT pn.experiment) AS n_experiment,
               count(DISTINCT bp.bioproject) AS n_bioproject
        FROM population pn
        JOIN annotation a ON a.biosample = pn.biosample
        LEFT JOIN biosample_bioproject bp ON bp.biosample = pn.biosample
        GROUP BY a.field, a.status
        ORDER BY a.field, a.status
        """
    )
    _derive_whole_population_counts(con, target_assays)
    con.execute(
        """
        CREATE TABLE population_count AS
        SELECT count(DISTINCT pn.biosample) AS n_biosample,
               count(DISTINCT pn.experiment) AS n_experiment,
               (SELECT count(DISTINCT bp.bioproject) FROM population pn2
                JOIN biosample_bioproject bp ON bp.biosample = pn2.biosample) AS n_bioproject
        FROM population pn
        """
    )


def _derive_whole_population_counts(con: duckdb.DuckDBPyConnection, target_assays: list[str]) -> None:
    """BioSamples of the whole population per target assay, per organism, and with a term per annotation field."""
    con.execute(
        """
        CREATE TABLE assay_count AS
        SELECT t.library_strategy, count(DISTINCT pn.biosample) AS n_biosample
        FROM (SELECT unnest(?::VARCHAR[]) AS library_strategy) t
        LEFT JOIN population pn ON pn.library_strategy = t.library_strategy
        GROUP BY t.library_strategy
        ORDER BY n_biosample DESC, t.library_strategy
        """,
        [target_assays],
    )
    con.execute(
        f"""
        CREATE TABLE organism_count AS
        SELECT b.organism_id, any_value(o.organism_name) AS organism_name, count(DISTINCT pn.biosample) AS n_biosample
        FROM population pn JOIN biosample b ON b.accession = pn.biosample
        LEFT JOIN ({ORGANISM_NAMES}) o ON o.organism_id = b.organism_id
        WHERE b.organism_id IS NOT NULL
        GROUP BY b.organism_id
        ORDER BY n_biosample DESC, b.organism_id
        """
    )
    con.execute(
        """
        CREATE TABLE field_mapped_count AS
        SELECT f.name AS field, count(DISTINCT m.biosample) AS n_biosample
        FROM field f
        LEFT JOIN (
            SELECT a.field, a.biosample FROM annotation a
            WHERE list_contains(?, a.status) AND a.biosample IN (SELECT biosample FROM population)
        ) m ON m.field = f.name
        GROUP BY f.name, f.position
        ORDER BY f.position
        """,
        [list(STATUS_GROUPS["mapped"])],
    )


def _omit_attributes(con: duckdb.DuckDBPyConnection) -> None:
    """Leave out of every BioSample the attributes under the mk2 filter keys in which no extracted value occurs.

    A key stays as soon as one of its attributes holds an extracted value of its BioSample, by the rule that evidence
    uses, so that leaving the other keys out removes no evidence.
    """
    candidates = sorted(MK2_FILTER_KEYS)
    con.execute(
        f"""
        CREATE TEMP TABLE candidate_attribute AS
        WITH attribute AS (
            SELECT accession, unnest(from_json(attributes, '{_ATTRIBUTES}')) AS a FROM biosample
        ),
        extracted AS (
            SELECT biosample, list(DISTINCT extracted_value) AS extracted_values FROM annotation
            WHERE extracted_value IS NOT NULL AND extracted_value <> '' GROUP BY biosample
        )
        SELECT attribute.a.name AS name, attribute.a.value AS value, extracted.extracted_values
        FROM attribute JOIN extracted ON extracted.biosample = attribute.accession
        WHERE list_contains(?, attribute.a.name) AND attribute.a.value IS NOT NULL
        """,
        [candidates],
    )
    held: set[str] = set()
    for name in candidates:
        con.execute("SELECT value, extracted_values FROM candidate_attribute WHERE name = ?", [name])
        while batch := con.fetchmany(_FETCH_ROWS):
            if any(find_spans(value, extracted) for value, values in batch for extracted in values):
                held.add(name)
                break
    con.execute("DROP TABLE candidate_attribute")
    omitted = [name for name in candidates if name not in held]
    con.execute("CREATE TABLE omitted_attribute (name VARCHAR PRIMARY KEY)")
    con.executemany("INSERT INTO omitted_attribute VALUES (?)", [[name] for name in omitted])
    con.execute(
        f"""
        UPDATE biosample
        SET attributes = to_json(list_filter(from_json(attributes, '{_ATTRIBUTES}'), x -> NOT list_contains(?, x.name)))
        WHERE len(list_filter(from_json(attributes, '{_ATTRIBUTES}'), x -> list_contains(?, x.name))) > 0
        """,
        [omitted, omitted],
    )


def _derive_searchable_text(con: duckdb.DuckDBPyConnection) -> None:
    """The searchable text of each BioSample of the population, in the form `dsl.keyword` matches against.

    The values (title, organism name, attribute values, extracted values, and term labels) are joined by " | " before
    normalization, so a phrase never spans two values. A word that joins its parts with symbols ("MCF-7") is added
    once more with its parts written together ("mcf7"), after the values and separated like a value of its own, so a
    phrase never spans two of them either. A "|" inside a value is a symbol like any other, so it is replaced before the
    values are joined.
    """
    con.execute(
        r"""
        CREATE TABLE searchable_text AS
        WITH annotation_values AS (
            SELECT biosample,
                   string_agg(
                       concat_ws(' | ', replace(extracted_value, '|', '/'), replace(term_label, '|', '/')), ' | '
                   ) AS value
            FROM annotation GROUP BY biosample
        ),
        raw AS (
            SELECT b.accession AS biosample,
                   lower(concat_ws(
                       ' | ',
                       replace(b.title, '|', '/'),
                       replace(b.organism_name, '|', '/'),
                       nullif(array_to_string(
                           list_transform(
                               from_json(b.description, '[{"value": "VARCHAR"}]'), x -> replace(x.value, '|', '/')
                           ),
                           ' | '
                       ), ''),
                       array_to_string(
                           list_transform(
                               from_json(b.attributes, '[{"value": "VARCHAR"}]'), x -> replace(x.value, '|', '/')
                           ),
                           ' | '
                       ),
                       a.value
                   )) AS value
            FROM biosample b LEFT JOIN annotation_values a ON a.biosample = b.accession
            WHERE b.accession IN (SELECT biosample FROM population)
        ),
        normalized AS (
            SELECT biosample,
                   regexp_replace(value, '[^a-z0-9|]+', ' ', 'g') AS words,
                   list_transform(
                       regexp_extract_all(value, '[a-z0-9]+(?:[^a-z0-9\s|]+[a-z0-9]+)+'),
                       w -> regexp_replace(w, '[^a-z0-9]+', '', 'g')
                   ) AS joined
            FROM raw
        )
        SELECT biosample,
               regexp_replace(
                   ' ' || replace(words, '|', ' | ') || ' | ' || array_to_string(joined, ' | ') || ' ', ' +', ' ', 'g'
               ) AS text
        FROM normalized
        ORDER BY biosample
        """
    )
