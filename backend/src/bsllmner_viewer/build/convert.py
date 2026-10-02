"""Conversion of one run (result + input) into row batches. Runs in worker processes."""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from pathlib import Path

import orjson
import pyarrow as pa
import pyarrow.parquet as pq

from bsllmner_viewer.build.inputs import plausible_publication_date, read_input
from bsllmner_viewer.build.selectresult import RunMetadata, iter_entries, load_select_result

ENTRY_SCHEMA = pa.schema(
    [
        ("run_id", pa.int32()),
        ("accession", pa.string()),
        ("organism_id", pa.int32()),
        ("organism_name", pa.string()),
        ("title", pa.string()),
        ("date_published", pa.date32()),
        ("attributes", pa.string()),
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
    entries_parquet: Path
    annotations_parquet: Path


def convert_run(task: ConvertTask) -> ConvertResult:
    """Read one run and write its entries and annotations as Parquet files.

    Raises ValueError when a result entry's accession is not in the input file.
    """
    docs = {doc.accession: doc for doc in read_input(task.input_file)}
    metadata, raw_entries = load_select_result(task.result_file)
    entries: dict[str, list[object]] = {name: [] for name in ENTRY_SCHEMA.names}
    annotations: dict[str, list[object]] = {name: [] for name in ANNOTATION_SCHEMA.names}
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
    pq.write_table(pa.table(entries, schema=ENTRY_SCHEMA), entries_path)
    pq.write_table(pa.table(annotations, schema=ANNOTATION_SCHEMA), annotations_path)
    return ConvertResult(
        run_id=task.run_id,
        name=task.name,
        metadata=metadata,
        entry_count=len(seen),
        annotation_count=len(annotations["accession"]),
        entries_parquet=entries_path,
        annotations_parquet=annotations_path,
    )


def utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
