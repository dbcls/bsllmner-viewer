"""Dataset information."""

from __future__ import annotations

from fastapi import APIRouter

from bsllmner_viewer.api.common import camelize_keys, version_ref
from bsllmner_viewer.api.deps import StoreDep
from bsllmner_viewer.api.problems import error_responses
from bsllmner_viewer.api.schemas import (
    DatasetAssay,
    DatasetOntology,
    DatasetOrganism,
    DatasetResponse,
    DslFieldDescription,
    FieldDescription,
    Totals,
)
from bsllmner_viewer.api.term_sites import ontology_name
from bsllmner_viewer.dsl.fields import STATUS_GROUPS

router = APIRouter(tags=["Dataset"])


@router.get(
    "/dataset",
    operation_id="getDataset",
    responses=error_responses(),
    response_model=DatasetResponse,
    summary="Version information, fields, and population totals",
    description=(
        "Returns what a client needs before it writes conditions: the version of the dataset, the target assays, the "
        "fields of the condition language with their kinds, the status groups, and the BioSample counts of the "
        "whole population per assay, organism, and field. Counts are in the BioSample unit, except `totals`, which "
        "has all three units."
    ),
)
def get_dataset(store: StoreDep) -> DatasetResponse:
    with store.cursor() as cur:
        totals = cur.execute("SELECT n_biosample, n_experiment, n_bioproject FROM population_count").fetchone()
        assays = cur.execute(
            "SELECT library_strategy, n_biosample FROM assay_count ORDER BY n_biosample DESC, library_strategy"
        ).fetchall()
        organisms = cur.execute(
            "SELECT organism_id, organism_name, n_biosample FROM organism_count ORDER BY n_biosample DESC, organism_id"
        ).fetchall()
        mapped = dict(cur.execute("SELECT field, n_biosample FROM field_mapped_count").fetchall())
        prefixes = [
            str(r[0])
            for r in cur.execute(
                "SELECT DISTINCT ontology FROM term WHERE contains(term_id, ':') ORDER BY ontology"
            ).fetchall()
        ]
    assert totals is not None
    return DatasetResponse(
        dataset_version=version_ref(store),
        version=camelize_keys(store.version.model_dump()),
        target_assays=list(store.target_assays),
        assays=[DatasetAssay(name=str(a), biosample_count=int(n)) for a, n in assays],
        fields=[
            FieldDescription(
                name=f.name,
                multi_valued=f.multi_valued,
                ontologies=list(f.ontologies),
                mapped_biosample_count=int(mapped.get(f.name, 0)),
            )
            for f in store.fields
        ],
        dsl_fields=[
            DslFieldDescription(name=name, kind=d.kind, operators=list(d.operators))
            for name in store.field_set.names()
            if (d := store.field_set.get(name)) is not None
        ],
        statuses={group: list(statuses) for group, statuses in STATUS_GROUPS.items()},
        totals=Totals(biosample=totals[0], experiment=totals[1], bioproject=totals[2]),
        ontologies=[DatasetOntology(prefix=p, name=ontology_name(p)) for p in prefixes],
        organisms=[DatasetOrganism(identifier=str(o), name=name, biosample_count=int(n)) for o, name, n in organisms],
    )
