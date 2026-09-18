"""BioSample entry detail."""

from __future__ import annotations

from fastapi import APIRouter

from bsllmner_viewer.api.common import version_ref
from bsllmner_viewer.api.deps import StoreDep
from bsllmner_viewer.api.problems import ApiError
from bsllmner_viewer.api.queries.evidence import STRING_MATCH, find_spans
from bsllmner_viewer.api.queries.records import attributes_of
from bsllmner_viewer.api.schemas import (
    Attribute,
    EntryAnnotation,
    EntryBioProject,
    EntryExperiment,
    EntryResponse,
    Evidence,
)

router = APIRouter(tags=["entries"])

TITLE_ATTRIBUTE = "title"


@router.get(
    "/entries/{accession}", response_model=EntryResponse, summary="A BioSample with its annotations and evidence"
)
def get_entry(store: StoreDep, accession: str) -> EntryResponse:
    with store.cursor() as cur:
        row = cur.execute(
            "SELECT b.accession, b.title, b.organism_id, b.organism_name, b.date_created, b.date_modified, "
            "b.attributes, r.name FROM biosample b JOIN run r USING (run_id) WHERE b.accession = ?",
            [accession],
        ).fetchone()
        if row is None:
            raise ApiError("not-found", "Not found", 404, f"BioSample {accession} is not in the dataset")
        annotation_rows = cur.execute(
            "SELECT field, extracted_value, status, term_id, term_label FROM annotation WHERE biosample = ? "
            "ORDER BY field, value_index",
            [accession],
        ).fetchall()
        experiments = cur.execute(
            """
            SELECT be.experiment, e.library_strategy,
                   EXISTS (SELECT 1 FROM record r WHERE r.biosample = be.biosample AND r.experiment = be.experiment),
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
    attributes = [
        Attribute(name=str(a.get("name")), value=str(a.get("value")), harmonized_name=a.get("harmonized_name"))
        for a in attributes_of(row[6])
    ]
    searchable: list[tuple[str, int, str]] = [(TITLE_ATTRIBUTE, -1, row[1])] if row[1] else []
    searchable += [(a.name, i, a.value) for i, a in enumerate(attributes)]
    annotations: list[EntryAnnotation] = []
    field_order = {f.name: f.position for f in store.fields}
    for field, value, status, term_id, label in sorted(annotation_rows, key=lambda r: field_order.get(str(r[0]), 99)):
        evidence: list[Evidence] = []
        if value:
            for name, index, text in searchable:
                evidence.extend(
                    Evidence(attribute=name, attribute_index=index, start=span.start, end=span.end, method=STRING_MATCH)
                    for span in find_spans(text, value)
                )
        annotations.append(
            EntryAnnotation(
                field=str(field), value=value, status=str(status), term_id=term_id, label=label, evidence=evidence
            )
        )
    return EntryResponse(
        dataset_version=version_ref(store),
        accession=str(row[0]),
        title=row[1],
        organism_id=row[2],
        organism_name=row[3],
        date_created=row[4].isoformat() if row[4] else None,
        date_modified=row[5].isoformat() if row[5] else None,
        run=str(row[7]),
        attributes=attributes,
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
