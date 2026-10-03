"""Exports of matching entries and accession lists."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Annotated, Literal

import orjson
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from bsllmner_viewer.api.common import q_of, version_ref
from bsllmner_viewer.api.deps import QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import NOT_FOUND_RESPONSE
from bsllmner_viewer.api.queries import entries as rq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.schemas import AccessionType, AnnotationValue, EntryItem, EntryType

router = APIRouter(tags=["Export"])

_BATCH = 1000

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


@router.get(
    "/export/accessions/{type}",
    operation_id="exportAccessions",
    responses=NOT_FOUND_RESPONSE,
    summary="Accession list of the matching entries, one per line",
    response_class=StreamingResponse,
)
def export_accessions(store: StoreDep, type: AccessionType, q: QParam = None) -> StreamingResponse:
    ast = parse_condition(store, q)
    pop = population(ast, store.field_set)
    version = version_ref(store)

    def lines() -> Iterator[bytes]:
        header = (
            f"# bsllmner-viewer {type} accessions; q={q_of(ast) or ''}; "
            f"dataset={version.name} {version.created_at} {version.digest}\n"
        )
        yield header.encode()
        with store.cursor() as cur:
            cur.execute(f"WITH {pop.cte()} {_ACCESSION_SQL[type]}", list(pop.params))
            while batch := cur.fetchmany(_BATCH):
                yield "".join(f"{row[0]}\n" for row in batch).encode()

    return StreamingResponse(
        lines(), media_type="text/plain; charset=utf-8", headers=_disposition(f"{type}-accessions.txt")
    )


@router.get(
    "/export/entries/{type}",
    operation_id="exportEntries",
    responses=NOT_FOUND_RESPONSE,
    summary="Matching entries as TSV or newline-delimited JSON",
    response_class=StreamingResponse,
)
def export_entries(
    store: StoreDep,
    type: EntryType,
    q: QParam = None,
    format: Annotated[Literal["tsv", "ndjson"], Query()] = "tsv",
) -> StreamingResponse:
    ast = parse_condition(store, q)
    pop = population(ast, store.field_set)
    fields = tuple(f.name for f in store.fields)

    def rows() -> Iterator[bytes]:
        if format == "tsv":
            head = [*(name for name, _ in TSV_COLUMNS), *fields]
            yield ("\t".join(head) + "\n").encode()
        with store.cursor() as cur:
            page = 1
            while True:
                keys = rq.page_keys(cur, pop, page, _BATCH)
                if not keys:
                    break
                for item in rq.entry_rows(cur, pop, keys, fields):
                    if format == "ndjson":
                        yield orjson.dumps(item.model_dump(mode="json", by_alias=True)) + b"\n"
                    else:
                        cells = [_plain_cell(get(item)) for _, get in TSV_COLUMNS]
                        for f in fields:
                            cells.append(";".join(_annotation_cell(a) for a in item.annotations.get(f, [])))
                        yield ("\t".join(cells) + "\n").encode()
                page += 1

    name = f"{type}-entries.{'tsv' if format == 'tsv' else 'ndjson'}"
    media = "text/tab-separated-values; charset=utf-8" if format == "tsv" else "application/x-ndjson"
    return StreamingResponse(rows(), media_type=media, headers=_disposition(name))


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


def _disposition(filename: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="{filename}"'}
