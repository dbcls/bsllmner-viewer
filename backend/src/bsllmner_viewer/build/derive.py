"""Derivation of query-ready tables from the raw tables."""

from __future__ import annotations

import duckdb
import pyarrow as pa

from bsllmner_viewer.build.convert import EVIDENCE_SCHEMA, metadata_groups
from bsllmner_viewer.build.errors import BuildError
from bsllmner_viewer.build.evidence import Text, trace_term
from bsllmner_viewer.build.inputs import Attribute
from bsllmner_viewer.build.mk2_filter_keys import MK2_FILTER_KEYS
from bsllmner_viewer.build.rows import insert_rows
from bsllmner_viewer.dsl.fields import STATUS_GROUPS
from bsllmner_viewer.dsl.keyword import searchable_text
from bsllmner_viewer.store.metadata import ATTRIBUTE, MetadataKind, stored_attributes, stored_description
from bsllmner_viewer.store.organisms import ORGANISM_NAMES
from bsllmner_viewer.store.schema import drop_derived_tables

_ATTRIBUTES = '[{"name": "VARCHAR", "value": "VARCHAR", "harmonized_name": "VARCHAR"}]'
_FETCH_ROWS = 10_000
_SEARCHABLE_TEXT_SCHEMA = pa.schema([("biosample", pa.string()), ("text", pa.string())])
_EVIDENCE_SCHEMA = pa.schema([("biosample", pa.string()), *list(EVIDENCE_SCHEMA)[2:]])


def _check_library_strategies(con: duckdb.DuckDBPyConnection) -> None:
    """Stop before any table is derived if an experiment of the dataset has two library strategies.

    The reference data can list an experiment twice. The same row twice counts once. Two strategies for an experiment
    of a BioSample of the runs stop the build, because the population depends on the strategy.
    """
    conflicts = con.execute(
        """
        SELECT r.accession, list(DISTINCT r.library_strategy ORDER BY r.library_strategy)
        FROM ref_experiment r
        WHERE r.library_strategy IS NOT NULL
          AND r.accession IN (
              SELECT experiment FROM ref_biosample_experiment WHERE biosample IN (SELECT accession FROM entry)
          )
        GROUP BY r.accession
        HAVING count(DISTINCT r.library_strategy) > 1
        ORDER BY r.accession
        LIMIT 5
        """
    ).fetchall()
    if conflicts:
        listed = "; ".join(f"{accession}: {', '.join(strategies)}" for accession, strategies in conflicts)
        raise BuildError(f"the SRA experiment data gives an experiment more than one library strategy: {listed}")


def derive(con: duckdb.DuckDBPyConnection, target_assays: list[str]) -> None:
    _check_library_strategies(con)
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
    con.execute(
        """
        CREATE TABLE term_synonym AS
        SELECT DISTINCT term_id, synonym FROM ref_term_synonym WHERE term_id IN (SELECT term_id FROM term)
        ORDER BY term_id
        """
    )
    _derive_evidence(con)
    _omit_attributes(con)
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


def _derive_evidence(con: duckdb.DuckDBPyConnection) -> None:
    """The evidence of the selected run of each BioSample, and the evidence through the names of terms.

    The names of terms come from the reference data, so a value is traced with them here, and only if it has a term and
    no evidence from its own text. The record is not searched: a name of a term in an identifier of the record is a
    coincidence. Evidence in the attributes points to the attributes of the input entry.
    """
    con.execute(
        """
        CREATE TABLE evidence AS
        SELECT e.accession AS biosample, e.field, e.value_index, e.kind, e.item, e.in_name, e.span_start, e.span_end,
               e.strategy
        FROM entry_evidence e JOIN biosample b ON b.accession = e.accession AND b.run_id = e.run_id
        """
    )
    con.execute(
        """
        SELECT a.biosample, a.field, a.value_index,
               list_filter([t.label, a.term_label], x -> x IS NOT NULL)
                   || coalesce((SELECT list(s.synonym ORDER BY s.synonym) FROM term_synonym s
                                WHERE s.term_id = a.term_id), []) AS names,
               b.title, b.description, b.attributes
        FROM annotation a
        JOIN term t ON t.term_id = a.term_id
        JOIN biosample b ON b.accession = a.biosample
        WHERE NOT EXISTS (
            SELECT 1 FROM evidence v
            WHERE v.biosample = a.biosample AND v.field = a.field AND v.value_index = a.value_index
        )
        ORDER BY a.biosample
        """
    )
    found: list[tuple[object, ...]] = []
    current: str | None = None
    items: list[list[tuple[MetadataKind, int, bool]]] = []
    texts: list[list[Text]] = []
    while batch := con.fetchmany(_FETCH_ROWS):
        for biosample, field, value_index, names, title, description, attributes in batch:
            if biosample != current:
                current = biosample
                items, texts = _searched_before_the_record(title, description, attributes)
            traced = trace_term(names, texts)
            if traced is None:
                continue
            for match in traced.matches:
                kind, item, in_name = items[traced.group][match.text]
                start, end = match.span.start, match.span.end
                found.append((biosample, field, value_index, kind, item, in_name, start, end, traced.strategy))
    insert_rows(con, "evidence", _EVIDENCE_SCHEMA, found)


def _searched_before_the_record(
    title: str | None, description: str, attributes: str
) -> tuple[list[list[tuple[MetadataKind, int, bool]]], list[list[Text]]]:
    described = stored_description(title, description)
    parsed = [Attribute(a.name, a.value) for a in stored_attributes(attributes)]
    return metadata_groups(described, parsed)


def _omit_attributes(con: duckdb.DuckDBPyConnection) -> None:
    """Omit from every BioSample the attributes under the mk2 filter keys that no evidence points to.

    A key stays as soon as evidence of one BioSample points to an attribute under it, so omitting the other keys
    removes no evidence. Evidence in the attributes then points to the attributes that remain.
    """
    candidates = sorted(MK2_FILTER_KEYS)
    held = {
        str(row[0])
        for row in con.execute(
            f"""
            SELECT DISTINCT from_json(b.attributes, '{_ATTRIBUTES}')[v.item + 1].name
            FROM evidence v JOIN biosample b ON b.accession = v.biosample
            WHERE v.kind = ?
            """,
            [ATTRIBUTE],
        ).fetchall()
    }
    omitted = [name for name in candidates if name not in held]
    con.execute("CREATE TABLE omitted_attribute (name VARCHAR PRIMARY KEY)")
    con.executemany("INSERT INTO omitted_attribute VALUES (?)", [[name] for name in omitted])
    con.execute(
        f"""
        CREATE OR REPLACE TABLE evidence AS
        SELECT v.biosample, v.field, v.value_index, v.kind,
               CASE WHEN v.kind = ? THEN v.item - len(list_filter(
                   list_slice(from_json(b.attributes, '{_ATTRIBUTES}'), 1, v.item), x -> list_contains(?, x.name)
               )) ELSE v.item END AS item,
               v.in_name, v.span_start, v.span_end, v.strategy
        FROM evidence v JOIN biosample b ON b.accession = v.biosample
        ORDER BY v.biosample, v.field, v.value_index, v.kind, item, v.span_start
        """,
        [ATTRIBUTE, omitted],
    )
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

    The values (the title, the organism name, the description paragraphs, the sample names, the synonyms, the attribute
    values, the extracted values, and the term labels) are joined by "|", and `dsl.keyword.searchable_text` splits them
    into words, so that the searchable text and the keywords split a text alike. A "|" inside a value is a symbol like
    any other, so it is replaced before the values are joined. The rows are read through a cursor and written in
    batches, so that the texts of the whole population are never in memory at once.
    """
    con.execute("CREATE TABLE searchable_text (biosample VARCHAR, text VARCHAR)")
    reader = con.cursor()
    try:
        reader.execute(
            """
            WITH annotation_values AS (
                SELECT biosample,
                       string_agg(
                           concat_ws('|', replace(extracted_value, '|', '/'), replace(term_label, '|', '/')), '|'
                           ORDER BY field, value_index
                       ) AS value
                FROM annotation GROUP BY biosample
            )
            SELECT b.accession,
                   concat_ws(
                       '|',
                       replace(b.title, '|', '/'),
                       replace(b.organism_name, '|', '/'),
                       nullif(array_to_string(
                           list_transform(
                               from_json(b.description, '[{"value": "VARCHAR"}]'), x -> replace(x.value, '|', '/')
                           ),
                           '|'
                       ), ''),
                       array_to_string(
                           list_transform(
                               from_json(b.attributes, '[{"value": "VARCHAR"}]'), x -> replace(x.value, '|', '/')
                           ),
                           '|'
                       ),
                       a.value
                   )
            FROM biosample b LEFT JOIN annotation_values a ON a.biosample = b.accession
            WHERE b.accession IN (SELECT biosample FROM population)
            ORDER BY b.accession
            """
        )
        while batch := reader.fetchmany(_FETCH_ROWS):
            rows = [(biosample, searchable_text(values or "")) for biosample, values in batch]
            insert_rows(con, "searchable_text", _SEARCHABLE_TEXT_SCHEMA, rows)
    finally:
        reader.close()
