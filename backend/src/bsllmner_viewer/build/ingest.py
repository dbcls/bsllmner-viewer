"""Build operations: full build, append, and reference refresh.

Every operation writes a new store file. The input store of append and refresh is only read.
"""

from __future__ import annotations

import fcntl
import hashlib
import logging
import os
import tempfile
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from itertools import islice
from multiprocessing import Pool
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa

from bsllmner_viewer.build.convert import ConvertResult, ConvertTask, convert_run, utc_now
from bsllmner_viewer.build.derive import derive
from bsllmner_viewer.build.errors import BuildError
from bsllmner_viewer.build.manifest import Manifest, RunSpec
from bsllmner_viewer.build.ontology import read_ontology
from bsllmner_viewer.build.reference import (
    load_dblink,
    read_bioprojects,
    read_chip_atlas,
    read_experiments,
    sql_literal,
)
from bsllmner_viewer.build.rows import insert_rows
from bsllmner_viewer.build.selectresult import RunMetadata, load_select_config, read_run_metadata
from bsllmner_viewer.build.verify import Verification, verify
from bsllmner_viewer.store.schema import RAW_TABLES, create_raw_tables
from bsllmner_viewer.store.version import SchemaVersionError, require_current_schema, write_meta

log = logging.getLogger(__name__)

_CHUNK_ROWS = 500_000
_RUN_TABLES = ("run", "field", "entry", "entry_annotation", "entry_evidence")


def build_full(manifest: Manifest, out: Path, *, workers: int = 4, threads: int | None = None) -> Verification:
    with _new_store(out, threads) as con:
        _load_fields(con, manifest, manifest.runs)
        _ingest_runs(con, manifest, manifest.runs, first_index=0, workers=workers, existing_model=None)
        _load_reference(con, manifest)
        return _finish(con, manifest)


def build_append(
    manifest: Manifest, store: Path, out: Path, *, workers: int = 4, threads: int | None = None
) -> Verification:
    with _new_store(out, threads) as con:
        existing = _copy_run_tables(con, store)
        new_runs = _new_runs(manifest, existing)
        if not new_runs:
            raise BuildError("the manifest has no runs that are not already in the store")
        _load_fields(con, manifest, new_runs)
        model = str(con.execute("SELECT model FROM run LIMIT 1").fetchone()[0])  # type: ignore[index]
        _ingest_runs(con, manifest, new_runs, first_index=len(existing), workers=workers, existing_model=model)
        _load_reference(con, manifest)
        return _finish(con, manifest)


def build_refresh(manifest: Manifest, store: Path, out: Path, *, threads: int | None = None) -> Verification:
    with _new_store(out, threads) as con:
        existing = _copy_run_tables(con, store)
        if [r.name for r in manifest.runs] != existing:
            raise BuildError("a reference refresh requires the manifest to list exactly the runs in the store")
        _load_reference(con, manifest)
        return _finish(con, manifest)


@contextmanager
def _new_store(out: Path, threads: int | None) -> Iterator[duckdb.DuckDBPyConnection]:
    """A connection to a new store that is written next to `out` and renamed to `out` when the block completes.

    If the block raises, nothing is left at `out` or next to it.
    """
    if out.exists():
        raise BuildError(f"{out} already exists; every build writes a new store file")
    out.parent.mkdir(parents=True, exist_ok=True)
    partial = out.with_name(out.name + ".partial")
    _require_unused(partial, out)
    _remove_store_files(partial)
    con = duckdb.connect(str(partial))
    try:
        if threads:
            con.execute(f"SET threads = {int(threads)}")
        con.execute("SET preserve_insertion_order = false")
        create_raw_tables(con)
        yield con
    except BaseException:
        con.close()
        _remove_store_files(partial)
        raise
    con.close()
    try:
        os.link(partial, out)
    except FileExistsError:
        _remove_store_files(partial)
        raise BuildError(f"{out} already exists; every build writes a new store file") from None
    _remove_store_files(partial)


def _require_unused(partial: Path, out: Path) -> None:
    """Stop when another build holds the partial file: DuckDB keeps an exclusive lock on a store file that it writes."""
    try:
        fd = os.open(partial, os.O_RDWR)
    except FileNotFoundError:
        return
    try:
        fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise BuildError(f"another build is writing {out}") from None
    finally:
        os.close(fd)


def _remove_store_files(path: Path) -> None:
    path.unlink(missing_ok=True)
    path.with_name(path.name + ".wal").unlink(missing_ok=True)


def _copy_run_tables(con: duckdb.DuckDBPyConnection, store: Path) -> list[str]:
    """Copy run-derived raw tables from an existing store; returns its run names in manifest order.

    The store must have the current schema version, so the raw tables of both stores have the same columns.
    """
    if not store.exists():
        raise BuildError(f"store {store} does not exist")
    con.execute(f"ATTACH '{sql_literal(store)}' AS src (READ_ONLY)")
    try:
        try:
            require_current_schema(con, store, catalog="src")
        except SchemaVersionError as e:
            raise BuildError(str(e)) from e
        for table in _RUN_TABLES:
            con.execute(f"INSERT INTO {table} SELECT * FROM src.{table}")
        names = [str(r[0]) for r in con.execute("SELECT name FROM src.run ORDER BY manifest_index").fetchall()]
    finally:
        con.execute("DETACH src")
    return names


def _new_runs(manifest: Manifest, existing: list[str]) -> list[RunSpec]:
    names = [r.name for r in manifest.runs]
    if names[: len(existing)] != existing:
        raise BuildError("the manifest must list the runs already in the store first, in the same order")
    return list(manifest.runs[len(existing) :])


def _load_fields(con: duckdb.DuckDBPyConnection, manifest: Manifest, runs: Iterable[RunSpec]) -> None:
    """Merge the select configurations of the runs into the field table."""
    existing: dict[str, tuple[bool, list[str]]] = {
        name: (multi, list(files))
        for name, multi, files in con.execute("SELECT name, multi_valued, ontology_files FROM field").fetchall()
    }
    order = [str(r[0]) for r in con.execute("SELECT name FROM field ORDER BY position").fetchall()]
    for run in runs:
        config = load_select_config(manifest.resolve(run.select_config))
        for name, spec in config.fields.items():
            multi = spec.value_type == "array"
            if name in existing:
                if existing[name][0] != multi:
                    raise BuildError(f"field {name!r} is single-valued in one run and multi-valued in another")
                if spec.ontology_file and spec.ontology_file not in existing[name][1]:
                    existing[name][1].append(spec.ontology_file)
            else:
                existing[name] = (multi, [spec.ontology_file] if spec.ontology_file else [])
                order.append(name)
    con.execute("DELETE FROM field")
    for position, name in enumerate(order):
        multi, files = existing[name]
        con.execute("INSERT INTO field VALUES (?, ?, ?, ?)", [name, position, multi, files])


def _ingest_runs(
    con: duckdb.DuckDBPyConnection,
    manifest: Manifest,
    runs: list[RunSpec],
    *,
    first_index: int,
    workers: int,
    existing_model: str | None,
) -> None:
    fields = tuple(str(r[0]) for r in con.execute("SELECT name FROM field ORDER BY position").fetchall())
    with tempfile.TemporaryDirectory(prefix="bsllmner-viewer-build-") as tmp:
        tasks = [
            ConvertTask(
                run_id=first_index + i + 1,
                name=run.name,
                result_file=manifest.resolve(run.result),
                input_file=manifest.resolve(run.input),
                fields=fields,
                out_dir=Path(tmp),
            )
            for i, run in enumerate(runs)
        ]
        _validate_runs(
            [(run.name, read_run_metadata(t.result_file)) for run, t in zip(runs, tasks, strict=True)], existing_model
        )
        results = _convert_all(tasks, workers)
        for i, (run, result) in enumerate(zip(runs, results, strict=True)):
            config_path = manifest.resolve(run.select_config)
            con.execute(
                "INSERT INTO run VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    result.run_id,
                    first_index + i,
                    run.name,
                    str(run.result),
                    str(run.input),
                    str(run.select_config),
                    sha256_of(config_path),
                    run.mk2_version,
                    result.metadata.model,
                    result.entry_count,
                    utc_now(),
                ],
            )
            con.execute("INSERT INTO entry SELECT * FROM read_parquet(?)", [str(result.entries_parquet)])
            con.execute("INSERT INTO entry_annotation SELECT * FROM read_parquet(?)", [str(result.annotations_parquet)])
            con.execute("INSERT INTO entry_evidence SELECT * FROM read_parquet(?)", [str(result.evidence_parquet)])
            log.info(
                "ingested run %s: %d entries, %d annotations, %d pieces of evidence",
                run.name,
                result.entry_count,
                result.annotation_count,
                result.evidence_count,
            )


def _convert_all(tasks: list[ConvertTask], workers: int) -> list[ConvertResult]:
    if workers <= 1 or len(tasks) == 1:
        return [convert_run(t) for t in tasks]
    with Pool(processes=min(workers, len(tasks))) as pool:
        return list(pool.imap(convert_run, tasks))


def _validate_runs(runs: list[tuple[str, RunMetadata]], existing_model: str | None) -> None:
    models = {metadata.model for _, metadata in runs}
    if existing_model is not None:
        models.add(existing_model)
    if len(models) > 1:
        raise BuildError(f"runs use different models: {', '.join(sorted(models))}")
    for name, metadata in runs:
        if metadata.status != "completed":
            raise BuildError(f"run {name} has status {metadata.status!r}, expected 'completed'")


def _load_reference(con: duckdb.DuckDBPyConnection, manifest: Manifest) -> None:
    for table in RAW_TABLES:
        if table.startswith("ref_"):
            con.execute(f"DELETE FROM {table}")
    ref = manifest.reference
    position = 0
    for ontology in ref.ontologies:
        files = [manifest.resolve(f) for f in ontology.files]
        con.execute(
            "INSERT INTO ref_ontology VALUES (?, ?, ?, ?)",
            [ontology.name, [str(f) for f in ontology.files], [sha256_of(f) for f in files], ontology.snapshot_date],
        )
        for file in files:
            _load_ontology_file(con, ontology.name, position, file)
            position += 1
        log.info("loaded ontology %s", ontology.name)
    _insert_rows(
        con,
        "ref_experiment",
        pa.schema([("accession", pa.string()), ("library_strategy", pa.string())]),
        read_experiments(manifest.resolve(ref.sra_experiments.path)),
    )
    log.info("loaded SRA experiments")
    counts = load_dblink(con, manifest.resolve(ref.dblink.path))
    log.info("loaded DBLink edges: %s", counts)
    _insert_rows(
        con,
        "ref_bioproject",
        pa.schema([("accession", pa.string()), ("title", pa.string())]),
        read_bioprojects(manifest.resolve(ref.bioprojects.path)),
    )
    _insert_rows(
        con,
        "ref_chip_atlas",
        pa.schema([("experiment", pa.string()), ("assembly", pa.string())]),
        read_chip_atlas(manifest.resolve(ref.chip_atlas.path)),
    )
    write_meta(
        con,
        "reference_snapshots",
        {
            "sra_experiments": ref.sra_experiments.snapshot_date,
            "dblink": ref.dblink.snapshot_date,
            "bioprojects": ref.bioprojects.snapshot_date,
            "chip_atlas": ref.chip_atlas.snapshot_date,
        },
    )


def _load_ontology_file(con: duckdb.DuckDBPyConnection, name: str, index: int, file: Path) -> None:
    """Load one ontology file; `index` is its position among all ontology files of the manifest."""
    terms: list[tuple[str, str, int, str | None]] = []
    synonyms: list[tuple[str, str]] = []
    parents: list[tuple[str, str]] = []
    for term in read_ontology(file):
        terms.append((term.term_id, name, index, term.label))
        synonyms.extend((term.term_id, s) for s in term.synonyms)
        parents.extend((term.term_id, p) for p in term.parents)
    _insert_rows(
        con,
        "ref_term",
        pa.schema(
            [("term_id", pa.string()), ("ontology", pa.string()), ("source_index", pa.int32()), ("label", pa.string())]
        ),
        iter(terms),
    )
    _insert_rows(
        con, "ref_term_synonym", pa.schema([("term_id", pa.string()), ("synonym", pa.string())]), iter(synonyms)
    )
    _insert_rows(
        con, "ref_term_parent", pa.schema([("term_id", pa.string()), ("parent_id", pa.string())]), iter(parents)
    )


def _insert_rows(
    con: duckdb.DuckDBPyConnection, table: str, schema: pa.Schema, rows: Iterator[tuple[Any, ...]]
) -> None:
    while chunk := list(islice(rows, _CHUNK_ROWS)):
        insert_rows(con, table, schema, chunk)


def _finish(con: duckdb.DuckDBPyConnection, manifest: Manifest) -> Verification:
    model = str(con.execute("SELECT model FROM run LIMIT 1").fetchone()[0])  # type: ignore[index]
    write_meta(con, "name", manifest.name)
    write_meta(con, "created_at", utc_now().isoformat(timespec="seconds") + "Z")
    write_meta(con, "model", model)
    write_meta(con, "target_assays", manifest.target_assays)
    derive(con, manifest.target_assays)
    log.info("derived query-ready tables")
    result = verify(con)
    write_meta(con, "verification", {"ok": result.ok, "problems": list(result.problems), "counts": result.counts})
    return result


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()
