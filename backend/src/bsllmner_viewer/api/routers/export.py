"""Exports of matching entries and accession lists."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Annotated, Literal

import orjson
from fastapi import APIRouter, Path, Query
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import iterate_in_threadpool

from bsllmner_viewer.api.common import q_of, version_ref
from bsllmner_viewer.api.deps import QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import DSL_SLUGS, error_responses
from bsllmner_viewer.api.queries import entries as rq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.schemas import AccessionType, AnnotationValue, DatasetVersionRef, EntryItem, EntryType
from bsllmner_viewer.api.store import ExportSession

router = APIRouter(tags=["Export"])

VERSION_HEADER = "X-Dataset-Version"

_VERSION_HEADER_DOC = {
    VERSION_HEADER: {
        "description": "Dataset version of the export: the name as a JSON string, the creation time, and the digest",
        "schema": {"type": "string"},
    }
}

TSV_COLUMNS: tuple[tuple[str, Callable[[EntryItem], str]], ...] = (
    ("identifier", lambda item: item.identifier),
    ("type", lambda item: item.type),
    ("experiments", lambda item: ";".join(item.experiments)),
    ("title", lambda item: item.title or ""),
    ("organismIdentifier", lambda item: item.organism.identifier if item.organism else ""),
    ("organismName", lambda item: (item.organism.name or "") if item.organism else ""),
    ("libraryStrategy", lambda item: ";".join(item.library_strategy)),
    ("bioprojects", lambda item: ";".join(item.bioprojects)),
    ("datePublished", lambda item: item.date_published or ""),
    ("chipAtlas", lambda item: ";".join(item.chip_atlas)),
)

_ACCESSION_SQL: dict[AccessionType, str] = {
    "biosample": "SELECT DISTINCT p.biosample FROM pop p ORDER BY 1",
    "sra-experiment": "SELECT DISTINCT p.experiment FROM pop p ORDER BY 1",
    "sra-run": "SELECT DISTINCT s.accession FROM pop p JOIN sra_run s ON s.experiment = p.experiment ORDER BY 1",
    "bioproject": (
        "SELECT DISTINCT bp.bioproject FROM pop p JOIN biosample_bioproject bp ON bp.biosample = p.biosample ORDER BY 1"
    ),
}


class _Stream:
    """The body of an export: the chunks of `chunks`, and the end of the export session when the body ends.

    The session ends when the chunks end or fail. `_response` also ends it when the client disconnects. The end in
    `__del__` is a last resort for a body that nobody reads.
    """

    def __init__(self, session: ExportSession, chunks: Iterator[bytes]) -> None:
        self._session = session
        self._chunks = chunks

    def __iter__(self) -> _Stream:
        return self

    def __next__(self) -> bytes:
        try:
            return next(self._chunks)
        except BaseException:
            self._session.close()
            raise

    def __del__(self) -> None:
        self._session.close()


def dataset_version(version: DatasetVersionRef) -> str:
    """The dataset version as an export names it. The name is a JSON string, so that the text is one line of ASCII."""
    return f"{json.dumps(version.name)} {version.created_at} {version.digest}"


def _response(
    session: ExportSession, chunks: Iterator[bytes], media_type: str, filename: str, version: DatasetVersionRef
) -> StreamingResponse:
    """The response of an export. The session ends as soon as the response ends, including a disconnect of the client,
    which cancels the body."""
    headers = {"Content-Disposition": f'attachment; filename="{filename}"', VERSION_HEADER: dataset_version(version)}
    stream = _Stream(session, chunks)

    async def body() -> AsyncIterator[bytes]:
        try:
            async for chunk in iterate_in_threadpool(stream):
                yield chunk
        finally:
            session.close()

    # The background task covers a client that disconnects before the body starts, when its `finally` cannot run.
    return StreamingResponse(body(), media_type=media_type, headers=headers, background=BackgroundTask(session.close))


@router.get(
    "/export/accessions/{type}",
    operation_id="exportAccessions",
    responses={
        **error_responses(bad_request=DSL_SLUGS, not_found=True, busy=True),
        200: {
            "description": "The header line and the accessions",
            "content": {"text/plain": {"schema": {"type": "string"}}},
            "headers": _VERSION_HEADER_DOC,
        },
    },
    summary="Export the accessions of the entries that match a condition",
    description=(
        "Returns every distinct accession of `type` among the entries that match `q`, as plain text: a header line "
        "that starts with `#` and names `q` and the dataset version, then one accession per line in ascending order. "
        'See "Entries" in /llms-full.txt.'
    ),
    response_class=StreamingResponse,
)
def export_accessions(
    store: StoreDep,
    type: Annotated[AccessionType, Path(description="Kind of accession to list")],
    q: QParam = None,
) -> StreamingResponse:
    ast = parse_condition(store, q)
    pop = population(ast, store.field_set)
    version = version_ref(store)
    batch_size = store.limits.export_batch
    session = store.open_export()
    try:
        # The first batch is read before the response starts, so that a store that cannot be read gives a 500.
        with session.timed():
            session.cursor.execute(f"WITH {pop.cte(session.cursor)} {_ACCESSION_SQL[type]}", list(pop.params))
            first = session.cursor.fetchmany(batch_size)
    except BaseException:
        session.close()
        raise

    def lines() -> Iterator[bytes]:
        header = (
            f"# bsllmner-viewer {type} accessions; q={json.dumps(q_of(ast) or '')}; "
            f"dataset={dataset_version(version)}\n"
        )
        yield header.encode()
        batch = first
        while batch:
            yield "".join(f"{row[0]}\n" for row in batch).encode()
            batch = session.cursor.fetchmany(batch_size)

    return _response(session, lines(), "text/plain; charset=utf-8", f"{type}-accessions.txt", version)


@router.get(
    "/export/entries/{type}",
    operation_id="exportEntries",
    responses={
        **error_responses(bad_request=DSL_SLUGS, not_found=True, busy=True),
        200: {
            "description": "The entries, one per line after the header line of the TSV",
            "content": {
                "text/tab-separated-values": {"schema": {"type": "string"}},
                "application/x-ndjson": {"schema": {"type": "string"}},
            },
            "headers": _VERSION_HEADER_DOC,
        },
    },
    summary="Export the BioSamples that match a condition as TSV or NDJSON",
    description=(
        "Returns every BioSample that matches `q`, in the order of the entry list, as TSV or as NDJSON. NDJSON is "
        "newline-delimited JSON: one JSON object per line. "
        'See "Entries" in /llms-full.txt for the columns and the cells.'
    ),
    response_class=StreamingResponse,
)
def export_entries(
    store: StoreDep,
    type: Annotated[EntryType, Path(description="Entry type. Only `biosample` has entries")],
    q: QParam = None,
    format: Annotated[Literal["tsv", "ndjson"], Query(description="File format of the entries")] = "tsv",
) -> StreamingResponse:
    ast = parse_condition(store, q)
    pop = population(ast, store.field_set)
    fields = tuple(f.name for f in store.fields)
    version = version_ref(store)
    batch_size = store.limits.export_batch
    session = store.open_export()

    def read_page(after: str | None) -> list[EntryItem]:
        with session.timed():
            keys = rq.keys_after(session.cursor, pop, after, batch_size)
            return rq.entry_rows(session.cursor, pop, keys, fields) if keys else []

    try:
        # The first page is read before the response starts, so that a store that cannot be read gives a 500.
        first = read_page(None)
    except BaseException:
        session.close()
        raise

    def rows() -> Iterator[bytes]:
        if format == "tsv":
            head = [*(name for name, _ in TSV_COLUMNS), *fields]
            yield ("\t".join(head) + "\n").encode()
        items = first
        while items:
            for item in items:
                if format == "ndjson":
                    yield orjson.dumps(item.model_dump(mode="json", by_alias=True)) + b"\n"
                else:
                    cells = [_plain_cell(get(item)) for _, get in TSV_COLUMNS]
                    for f in fields:
                        cells.append(";".join(_annotation_cell(a) for a in item.annotations.get(f, [])))
                    yield ("\t".join(cells) + "\n").encode()
            items = read_page(items[-1].identifier)

    name = f"{type}-entries.{'tsv' if format == 'tsv' else 'ndjson'}"
    media = "text/tab-separated-values; charset=utf-8" if format == "tsv" else "application/x-ndjson"
    return _response(session, rows(), media, name, version)


def _plain_cell(value: str) -> str:
    return value.replace("\t", " ").replace("\r", " ").replace("\n", " ")


_PART_ESCAPES = {"%": "%25", "|": "%7C", ";": "%3B", "\t": "%09", "\r": "%0D", "\n": "%0A"}


def _escape_part(value: str | None) -> str:
    """The value with the characters that delimit a cell percent-encoded."""
    return "".join(_PART_ESCAPES.get(ch, ch) for ch in value or "")


def _annotation_cell(annotation: AnnotationValue) -> str:
    """`value|termId|label|status`: four parts in this order, empty when missing."""
    parts = (annotation.value, annotation.term_id, annotation.label, annotation.status)
    return "|".join(_escape_part(part) for part in parts)
