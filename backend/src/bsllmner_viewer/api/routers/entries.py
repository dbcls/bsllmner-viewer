"""Entry lists and the BioSample detail."""

from __future__ import annotations

from typing import Annotated

import orjson
from fastapi import APIRouter, Path

from bsllmner_viewer.api.common import q_of, version_ref
from bsllmner_viewer.api.deps import PageParam, PerPageParam, QParam, StoreDep, parse_condition
from bsllmner_viewer.api.problems import DSL_SLUGS, ApiError, error_responses
from bsllmner_viewer.api.queries import entries as rq
from bsllmner_viewer.api.queries.core import population
from bsllmner_viewer.api.queries.dimensions import clauses_for, dimension
from bsllmner_viewer.api.queries.entries import organism_of
from bsllmner_viewer.api.record_names import record_name
from bsllmner_viewer.api.schemas import (
    ACCESSION_MAX_LENGTH,
    EntriesResponse,
    EntryAnnotation,
    EntryBioProject,
    EntryExperiment,
    EntryResponse,
    EntryType,
    Evidence,
    MetadataItem,
    Pagination,
)
from bsllmner_viewer.build.mk2_filter_keys import MK2_FILTER_KEYS
from bsllmner_viewer.dsl.keyword import accession_kind
from bsllmner_viewer.store.metadata import ATTRIBUTE, DESCRIPTION, RECORD, stored_attributes, stored_description

router = APIRouter(tags=["Entries"])


@router.get(
    "/entries/{type}",
    operation_id="listEntries",
    responses=error_responses(bad_request=DSL_SLUGS, not_found=True, busy=True),
    response_model=EntriesResponse,
    summary="List the BioSamples that match a condition",
    description=(
        "Lists the BioSamples that match `q`, one page at a time. `pagination.total` is the count of `q` in the "
        "BioSample unit. Each item lists the SRA Experiments of the BioSample that match `q`. An entry type that is "
        "not `biosample` gets 404. The Samples view of the UI uses this operation. "
        'See "Entries" in /llms-full.txt.'
    ),
)
def list_entries(
    store: StoreDep,
    type: Annotated[EntryType, Path(description="Entry type. Only `biosample` has entries")],
    q: QParam = None,
    page: PageParam = 1,
    per_page: PerPageParam = 25,
) -> EntriesResponse:
    ast = parse_condition(store, q)
    pop = population(ast, store.field_set)
    with store.cursor(heavy=True) as cur:
        total = rq.count_entries(cur, pop)
        keys = rq.page_keys(cur, pop, page, per_page) if (page - 1) * per_page < total else []
        rows = rq.entry_rows(cur, pop, keys, tuple(f.name for f in store.fields))
    return EntriesResponse(
        dataset_version=version_ref(store),
        q=q_of(ast),
        type=type,
        pagination=Pagination.of(page, per_page, total),
        items=rows,
    )


@router.get(
    "/entries/biosample/{accession}",
    operation_id="getEntry",
    responses=error_responses(not_found=True),
    response_model=EntryResponse,
    summary="Get a BioSample with its annotations and evidence",
    description=(
        "Returns one BioSample with its original metadata, annotations with evidence, SRA Experiments, and "
        "BioProjects. The BioSample does not have to be in the population: `inPopulation` of each SRA Experiment "
        "tells whether the SRA Experiment is in the population. "
        "`run` is the name of the bsllmner-mk2 run that analyzed the BioSample, not an SRA Run. "
        "An accession that is not that of a BioSample gets 404. Find the BioSample of another accession with the "
        'accession as a keyword in `q`. See "Entries" in /llms-full.txt.'
    ),
)
def get_entry(
    store: StoreDep,
    accession: Annotated[
        str, Path(max_length=ACCESSION_MAX_LENGTH, description="BioSample accession, such as `SAMN14864678`")
    ],
) -> EntryResponse:
    with store.cursor() as cur:
        row = cur.execute(
            "SELECT b.accession, b.title, b.organism_id, b.organism_name, b.date_published, "
            "b.attributes, r.name, b.description, b.record FROM biosample b JOIN run r USING (run_id) "
            "WHERE b.accession = ?",
            [accession],
        ).fetchone()
        if row is None:
            detail = f"BioSample {accession} is not in the dataset"
            if accession_kind(accession) != "biosample" or accession != accession.upper():
                detail += (
                    f"; {accession!r} is not an upper-case BioSample accession. "
                    "to find its BioSample, use it as a keyword in `q` of GET /api/entries/biosample"
                )
            raise ApiError(None, 404, detail)
        annotation_rows = cur.execute(
            "SELECT field, value_index, extracted_value, status, term_id, term_label FROM annotation "
            "WHERE biosample = ? ORDER BY field, value_index",
            [accession],
        ).fetchall()
        evidence_rows = cur.execute(
            "SELECT field, value_index, kind, item, in_name, span_start, span_end, strategy FROM evidence "
            "WHERE biosample = ?",
            [accession],
        ).fetchall()
        experiments = cur.execute(
            """
            SELECT be.experiment, e.library_strategy,
                   EXISTS (SELECT 1 FROM population pn
                           WHERE pn.biosample = be.biosample AND pn.experiment = be.experiment),
                   (SELECT list(accession ORDER BY accession) FROM sra_run s WHERE s.experiment = be.experiment),
                   (SELECT list(assembly ORDER BY assembly) FROM chip_atlas c WHERE c.experiment = be.experiment)
            FROM biosample_experiment be JOIN experiment e ON e.accession = be.experiment
            WHERE be.biosample = ? ORDER BY be.experiment
            """,
            [accession],
        ).fetchall()
        bioprojects = cur.execute(
            "SELECT bb.bioproject, b.title FROM biosample_bioproject bb "
            "LEFT JOIN bioproject b ON b.accession = bb.bioproject WHERE bb.biosample = ? ORDER BY bb.bioproject",
            [accession],
        ).fetchall()
    described = stored_description(row[1], row[7])
    record = orjson.loads(row[8])
    attributes = stored_attributes(row[5])
    items = [
        *(MetadataItem(kind=DESCRIPTION, name=name, value=value, harmonized_name=None) for name, value in described),
        *(
            MetadataItem(kind=RECORD, name=record_name(str(r["path"])), value=str(r["value"]), harmonized_name=None)
            for r in record
        ),
        *(
            MetadataItem(
                kind=ATTRIBUTE,
                name=a.name,
                value=a.value,
                harmonized_name=a.harmonized_name,
            )
            for a in attributes
        ),
    ]
    # Evidence identifies an item by its kind and its position among the items of that kind.
    offset: dict[str, int] = {DESCRIPTION: 0, RECORD: len(described), ATTRIBUTE: len(described) + len(record)}
    found: dict[tuple[str, int], list[tuple[int, bool, int, int, str]]] = {}
    for field, value_index, kind, item, in_name, start, end, strategy in evidence_rows:
        found.setdefault((str(field), int(value_index)), []).append(
            (offset[str(kind)] + int(item), bool(in_name), int(start), int(end), str(strategy))
        )
    # An attribute under a name that bsllmner-mk2 drops, and an item of the record, describe how the BioSample was
    # submitted and archived. The response includes such an item only when evidence of the BioSample points to it.
    evidenced = {index for pieces in found.values() for index, *_ in pieces}
    shown = [
        index
        for index, item in enumerate(items)
        if item.kind == "description"
        or (item.kind == "attribute" and item.name not in MK2_FILTER_KEYS)
        or index in evidenced
    ]
    position = {index: at for at, index in enumerate(shown)}
    field_order = {f.name: f.position for f in store.fields}
    annotations = [
        EntryAnnotation(
            field=str(field),
            value=value,
            status=str(status),
            term_id=term_id,
            label=label,
            clauses=[] if term_id is None else clauses_for(dimension(store.field_set, str(field)), term_id),
            evidence=[
                Evidence(
                    name=items[index].name,
                    metadata_index=position[index],
                    in_name=in_name,
                    start=start,
                    end=end,
                    strategy=strategy,
                )
                for index, in_name, start, end, strategy in sorted(found.get((str(field), int(value_index)), []))
            ],
        )
        for field, value_index, value, status, term_id, label in sorted(
            annotation_rows, key=lambda r: field_order.get(str(r[0]), 99)
        )
    ]
    return EntryResponse(
        dataset_version=version_ref(store),
        identifier=str(row[0]),
        type="biosample",
        title=row[1],
        organism=organism_of(row[2], row[3]),
        date_published=row[4].isoformat() if row[4] else None,
        run=str(row[6]),
        metadata=[items[index] for index in shown],
        annotations=annotations,
        experiments=[
            EntryExperiment(
                accession=str(ex),
                library_strategy=strategy,
                in_population=bool(in_pop),
                runs=[str(r) for r in (runs or [])],
                chip_atlas=[str(a) for a in (assemblies or [])],
            )
            for ex, strategy, in_pop, runs, assemblies in experiments
        ],
        bioprojects=[EntryBioProject(accession=str(a), title=t) for a, t in bioprojects],
    )
