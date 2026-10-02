"""Exports of matching entries and accession lists."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated, Literal

import orjson
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from bsllmner_viewer.api.common import q_of, version_ref
from bsllmner_viewer.api.deps import QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import NOT_FOUND_RESPONSE
from bsllmner_viewer.api.queries import entries as rq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.schemas import AccessionType, EntryType

router = APIRouter(tags=["Export"])

_BATCH = 1000

TSV_COLUMNS = (
    "identifier",
    "type",
    "experiments",
    "title",
    "organismIdentifier",
    "organismName",
    "libraryStrategy",
    "bioprojects",
    "dateCreated",
    "chipAtlas",
)

_ACCESSION_SQL: dict[str, str] = {
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
            head = [*TSV_COLUMNS, *fields]
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
                        cells = [
                            item.identifier,
                            item.type,
                            ";".join(item.experiments),
                            item.title or "",
                            item.organism.identifier if item.organism else "",
                            (item.organism.name or "") if item.organism else "",
                            ";".join(item.library_strategy),
                            ";".join(item.bioprojects),
                            item.date_created or "",
                            ";".join(item.chip_atlas),
                        ]
                        for f in fields:
                            cells.append(
                                ";".join(
                                    _annotation_cell(a.value, a.term_id, a.label, a.status)
                                    for a in item.annotations.get(f, [])
                                )
                            )
                        yield ("\t".join(c.replace("\t", " ").replace("\n", " ") for c in cells) + "\n").encode()
                page += 1

    name = f"{type}-entries.{'tsv' if format == 'tsv' else 'ndjson'}"
    media = "text/tab-separated-values; charset=utf-8" if format == "tsv" else "application/x-ndjson"
    return StreamingResponse(rows(), media_type=media, headers=_disposition(name))


def _annotation_cell(value: str | None, term_id: str | None, label: str | None, status: str) -> str:
    if term_id:
        return f"{value}|{term_id}|{label or ''}|{status}"
    if value:
        return f"{value}||{status}"
    return status


def _disposition(filename: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="{filename}"'}
