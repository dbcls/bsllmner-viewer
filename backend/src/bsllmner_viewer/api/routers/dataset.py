"""Dataset information."""

from __future__ import annotations

from fastapi import APIRouter

from bsllmner_viewer.api.common import version_ref
from bsllmner_viewer.api.deps import StoreDep
from bsllmner_viewer.api.schemas import DatasetResponse, DslFieldDescription, FieldDescription, Organism, Totals
from bsllmner_viewer.dsl.fields import STATUS_GROUPS

router = APIRouter(tags=["dataset"])


@router.get("/dataset", response_model=DatasetResponse, summary="Version information, fields, and population totals")
def get_dataset(store: StoreDep) -> DatasetResponse:
    with store.cursor() as cur:
        totals = cur.execute(
            "SELECT n_biosample, n_experiment, n_bioproject, n_record FROM population_count"
        ).fetchone()
        organisms = cur.execute(
            "SELECT b.organism_id, any_value(b.organism_name), count(DISTINCT r.biosample) AS n "
            "FROM record r JOIN biosample b ON b.accession = r.biosample "
            "WHERE b.organism_id IS NOT NULL GROUP BY b.organism_id ORDER BY n DESC"
        ).fetchall()
    assert totals is not None
    return DatasetResponse(
        dataset_version=version_ref(store),
        version=store.version.model_dump(),
        target_assays=list(store.target_assays),
        fields=[
            FieldDescription(name=f.name, multi_valued=f.multi_valued, ontologies=list(f.ontologies))
            for f in store.fields
        ],
        dsl_fields=[
            DslFieldDescription(name=name, kind=d.kind, operators=list(d.operators))
            for name in store.field_set.names()
            if (d := store.field_set.get(name)) is not None
        ],
        statuses={group: list(statuses) for group, statuses in STATUS_GROUPS.items()},
        totals=Totals(biosample=totals[0], experiment=totals[1], bioproject=totals[2], record=totals[3]),
        organisms=[Organism(organism_id=int(o), name=name, n_biosample=int(n)) for o, name, n in organisms],
    )
