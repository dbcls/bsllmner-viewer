"""Conversion of one run (result + input) into row batches. Runs in worker processes."""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from pathlib import Path

import orjson
import pyarrow as pa
import pyarrow.parquet as pq

from bsllmner_viewer.build.evidence import Text, Traced, trace
from bsllmner_viewer.build.inputs import Attribute, InputDoc, plausible_publication_date, read_input
from bsllmner_viewer.build.selectresult import AnnotationRow, RunMetadata, iter_entries, load_select_result
from bsllmner_viewer.store.metadata import ATTRIBUTE, DESCRIPTION, RECORD, description_items

ENTRY_SCHEMA = pa.schema(
    [
        ("run_id", pa.int32()),
        ("accession", pa.string()),
        ("organism_id", pa.int32()),
        ("organism_name", pa.string()),
        ("title", pa.string()),
        ("date_published", pa.date32()),
        ("attributes", pa.string()),
        ("description", pa.string()),
        ("record", pa.string()),
    ]
)

ANNOTATION_SCHEMA = pa.schema(
    [
        ("run_id", pa.int32()),
        ("accession", pa.string()),
        ("field", pa.string()),
        ("value_index", pa.int32()),
        ("extracted_value", pa.string()),
        ("status", pa.string()),
        ("term_id", pa.string()),
        ("term_label", pa.string()),
    ]
)

EVIDENCE_SCHEMA = pa.schema(
    [
        ("run_id", pa.int32()),
        ("accession", pa.string()),
        ("field", pa.string()),
        ("value_index", pa.int32()),
        ("kind", pa.string()),
        ("item", pa.int32()),
        ("in_name", pa.bool_()),
        ("span_start", pa.int32()),
        ("span_end", pa.int32()),
        ("strategy", pa.string()),
    ]
)


@dataclass(frozen=True, slots=True)
class ConvertTask:
    run_id: int
    name: str
    result_file: Path
    input_file: Path
    fields: tuple[str, ...]
    out_dir: Path


@dataclass(frozen=True, slots=True)
class ConvertResult:
    run_id: int
    name: str
    metadata: RunMetadata
    entry_count: int
    annotation_count: int
    evidence_count: int
    entries_parquet: Path
    annotations_parquet: Path
    evidence_parquet: Path


@dataclass(frozen=True, slots=True)
class _Evidence:
    field: str
    value_index: int
    kind: str
    item: int
    in_name: bool
    start: int
    end: int
    strategy: str


def metadata_groups(
    described: list[tuple[str, str]], attributes: list[Attribute]
) -> tuple[list[list[tuple[str, int, bool]]], list[list[Text]]]:
    """The groups of texts that are searched before the record, with the item of each text as (kind, position, in name):
    the description and the values of the attributes, then the names of the attributes."""
    values = [(DESCRIPTION, at, False) for at in range(len(described))]
    values += [(ATTRIBUTE, at, False) for at in range(len(attributes))]
    names = [(ATTRIBUTE, at, True) for at in range(len(attributes))]
    texts = [Text(value) for _, value in described] + [Text(a.value) for a in attributes]
    return [values, names], [texts, [Text(a.name) for a in attributes]]


def trace_entry(doc: InputDoc, annotations: list[AnnotationRow]) -> list[_Evidence]:
    """The evidence of the extracted values of an entry, with the strategies that need only the run.

    The description and the values of the attributes are searched first, then the names of the attributes, and then the
    record. An item of the record is identified by its position in the whole record of the input entry.
    """
    items, texts = metadata_groups(description_items(doc.title, doc.description), doc.attributes)
    items.append([(RECORD, at, False) for at in range(len(doc.record))])
    texts.append([Text(value) for _, value in doc.record])
    traced: dict[str, Traced | None] = {}
    found: list[_Evidence] = []
    for row in annotations:
        value = row.extracted_value
        if not value:
            continue
        if value not in traced:
            traced[value] = trace(value, texts)
        result = traced[value]
        if result is None:
            continue
        for match in result.matches:
            kind, item, in_name = items[result.group][match.text]
            found.append(
                _Evidence(
                    row.field, row.value_index, kind, item, in_name, match.span.start, match.span.end, result.strategy
                )
            )
    return found


def convert_run(task: ConvertTask) -> ConvertResult:
    """Read one run and write its entries and annotations as Parquet files.

    Raises ValueError when a result entry's accession is not in the input file.
    """
    docs = {doc.accession: doc for doc in read_input(task.input_file)}
    metadata, raw_entries = load_select_result(task.result_file)
    entries: dict[str, list[object]] = {name: [] for name in ENTRY_SCHEMA.names}
    annotations: dict[str, list[object]] = {name: [] for name in ANNOTATION_SCHEMA.names}
    evidence: dict[str, list[object]] = {name: [] for name in EVIDENCE_SCHEMA.names}
    seen: set[str] = set()
    for entry in iter_entries(raw_entries, list(task.fields)):
        doc = docs.get(entry.accession)
        if doc is None:
            raise ValueError(
                f"run {task.name}: entry {entry.accession} is not in the input file {task.input_file.name}"
            )
        if entry.accession in seen:
            continue
        seen.add(entry.accession)
        entries["run_id"].append(task.run_id)
        entries["accession"].append(entry.accession)
        entries["organism_id"].append(doc.organism_id)
        entries["organism_name"].append(doc.organism_name)
        entries["title"].append(doc.title)
        entries["date_published"].append(plausible_publication_date(doc.date_published, metadata.start_time))
        entries["attributes"].append(
            orjson.dumps(
                [{"name": a.name, "value": a.value, "harmonized_name": a.harmonized_name} for a in doc.attributes]
            ).decode()
        )
        entries["description"].append(orjson.dumps([{"name": n, "value": v} for n, v in doc.description]).decode())
        found = trace_entry(doc, entry.annotations)
        # The record keeps only the items that evidence points to; the rest are identifiers and dates.
        kept = sorted({e.item for e in found if e.kind == RECORD})
        position = {item: at for at, item in enumerate(kept)}
        entries["record"].append(
            orjson.dumps([{"path": doc.record[i][0], "value": doc.record[i][1]} for i in kept]).decode()
        )
        for e in found:
            evidence["run_id"].append(task.run_id)
            evidence["accession"].append(entry.accession)
            evidence["field"].append(e.field)
            evidence["value_index"].append(e.value_index)
            evidence["kind"].append(e.kind)
            evidence["item"].append(position[e.item] if e.kind == RECORD else e.item)
            evidence["in_name"].append(e.in_name)
            evidence["span_start"].append(e.start)
            evidence["span_end"].append(e.end)
            evidence["strategy"].append(e.strategy)
        for row in entry.annotations:
            annotations["run_id"].append(task.run_id)
            annotations["accession"].append(entry.accession)
            annotations["field"].append(row.field)
            annotations["value_index"].append(row.value_index)
            annotations["extracted_value"].append(row.extracted_value)
            annotations["status"].append(row.status)
            annotations["term_id"].append(row.term_id)
            annotations["term_label"].append(row.term_label)
    entries_path = task.out_dir / f"{task.run_id:04d}_entries.parquet"
    annotations_path = task.out_dir / f"{task.run_id:04d}_annotations.parquet"
    evidence_path = task.out_dir / f"{task.run_id:04d}_evidence.parquet"
    pq.write_table(pa.table(entries, schema=ENTRY_SCHEMA), entries_path)
    pq.write_table(pa.table(annotations, schema=ANNOTATION_SCHEMA), annotations_path)
    pq.write_table(pa.table(evidence, schema=EVIDENCE_SCHEMA), evidence_path)
    return ConvertResult(
        run_id=task.run_id,
        name=task.name,
        metadata=metadata,
        entry_count=len(seen),
        annotation_count=len(annotations["accession"]),
        evidence_count=len(evidence["accession"]),
        entries_parquet=entries_path,
        annotations_parquet=annotations_path,
        evidence_parquet=evidence_path,
    )


def utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
