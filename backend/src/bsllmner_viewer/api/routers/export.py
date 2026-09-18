"""Exports of matching records and accession lists."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated, Literal

import orjson
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from bsllmner_viewer.api.common import q_of, version_ref
from bsllmner_viewer.api.deps import QParam, StoreDep, parse_condition
from bsllmner_viewer.api.queries import records as rq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.schemas import RecordUnit

router = APIRouter(tags=["export"])

type AccessionKind = Literal["biosample", "experiment", "run", "bioproject"]
_BATCH = 1000

_ACCESSION_SQL: dict[str, str] = {
    "biosample": "SELECT DISTINCT p.biosample FROM pop p ORDER BY 1",
    "experiment": "SELECT DISTINCT p.experiment FROM pop p ORDER BY 1",
    "run": "SELECT DISTINCT s.accession FROM pop p JOIN sra_run s ON s.experiment = p.experiment ORDER BY 1",
    "bioproject": (
        "SELECT DISTINCT bp.bioproject FROM pop p JOIN biosample_bioproject bp ON bp.biosample = p.biosample ORDER BY 1"
    ),
}


@router.get(
    "/export/accessions",
    summary="Accession list of the matching records, one per line",
    response_class=StreamingResponse,
)
def export_accessions(store: StoreDep, kind: AccessionKind, q: QParam = None) -> StreamingResponse:
    ast = parse_condition(store, q)
    pop = population(ast, store.field_set)
    version = version_ref(store)

    def lines() -> Iterator[bytes]:
        header = (
            f"# bsllmner-viewer {kind} accessions; q={q_of(ast) or ''}; "
            f"dataset={version.name} {version.created_at} {version.digest}\n"
        )
        yield header.encode()
        with store.cursor() as cur:
            cur.execute(f"WITH {pop.cte()} {_ACCESSION_SQL[kind]}", list(pop.params))
            while batch := cur.fetchmany(_BATCH):
                yield "".join(f"{row[0]}\n" for row in batch).encode()

    return StreamingResponse(
        lines(), media_type="text/plain; charset=utf-8", headers=_disposition(f"{kind}-accessions.txt")
    )


@router.get("/export/records", summary="Matching records as TSV or JSON lines", response_class=StreamingResponse)
def export_records(
    store: StoreDep,
    q: QParam = None,
    unit: Annotated[RecordUnit, Query()] = "biosample",
    format: Annotated[Literal["tsv", "json"], Query()] = "tsv",
) -> StreamingResponse:
    ast = parse_condition(store, q)
    pop = population(ast, store.field_set)
    fields = tuple(f.name for f in store.fields)
    version = version_ref(store)

    def rows() -> Iterator[bytes]:
        if format == "tsv":
            head = [
                "biosample",
                "experiment",
                "title",
                "organism_id",
                "organism_name",
                "library_strategy",
                "bioprojects",
                "date_created",
                "chip_atlas",
                *fields,
            ]
            yield ("\t".join(head) + "\n").encode()
        else:
            yield orjson.dumps({"dataset_version": version.model_dump(), "q": q_of(ast), "unit": unit}) + b"\n"
        with store.cursor() as cur:
            page = 1
            while True:
                keys = rq.page_keys(cur, pop, unit, page, _BATCH)
                if not keys:
                    break
                for rec in rq.record_rows(cur, pop, keys, fields):
                    if format == "json":
                        yield orjson.dumps(rec.model_dump()) + b"\n"
                    else:
                        cells = [
                            rec.biosample,
                            rec.experiment or ";".join(rec.experiments),
                            rec.title or "",
                            str(rec.organism_id or ""),
                            rec.organism_name or "",
                            ";".join(rec.library_strategy),
                            ";".join(rec.bioprojects),
                            rec.date_created or "",
                            ";".join(rec.chip_atlas),
                        ]
                        for f in fields:
                            cells.append(
                                ";".join(
                                    _annotation_cell(a.value, a.term_id, a.label, a.status)
                                    for a in rec.annotations.get(f, [])
                                )
                            )
                        yield ("\t".join(c.replace("\t", " ").replace("\n", " ") for c in cells) + "\n").encode()
                page += 1

    name = f"records.{'tsv' if format == 'tsv' else 'jsonl'}"
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
