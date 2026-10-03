"""Response and request models of the api."""

from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer
from pydantic.alias_generators import to_camel

ClauseJson = TypedDict(
    "ClauseJson", {"field": str, "value": NotRequired[str], "from": NotRequired[str], "to": NotRequired[str]}
)

type Unit = Literal["biosample", "sra-experiment", "bioproject"]
type EntryType = Literal["biosample"]
type AccessionType = Literal["biosample", "sra-experiment", "sra-run", "bioproject"]


class ApiModel(BaseModel):
    """Base of every model of the api: camelCase JSON properties, accepted by field name as well."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, validate_by_name=True, serialize_by_alias=True)


class DatasetVersionRef(ApiModel):
    """Identifies the store a response was computed from. Full details are returned by the dataset endpoint."""

    name: str
    created_at: str
    model: str
    digest: str = Field(description="Short hash of the full version information")


class Clause(ApiModel):
    """One DSL clause, as `field` with `value` or with a date range `from`/`to`."""

    field: str
    value: str | None = None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None

    @model_serializer(mode="wrap")
    def _omit_unused(self, handler: SerializerFunctionWrapHandler) -> ClauseJson:
        data: dict[str, Any] = handler(self)
        return {k: v for k, v in data.items() if v is not None}  # type: ignore[return-value]


class FieldDescription(ApiModel):
    name: str
    multi_valued: bool
    ontologies: list[str]


class DslFieldDescription(ApiModel):
    name: str
    kind: str
    operators: list[str]


class Totals(ApiModel):
    biosample: int
    experiment: int
    bioproject: int


class DatasetResponse(ApiModel):
    dataset_version: DatasetVersionRef
    version: dict[str, Any] = Field(description="Full dataset version information")
    target_assays: list[str]
    fields: list[FieldDescription]
    dsl_fields: list[DslFieldDescription]
    statuses: dict[str, list[str]] = Field(description="Status groups and the statuses under them")
    totals: Totals
    organisms: list[DatasetOrganism]


class Organism(ApiModel):
    """An organism as the NCBI Taxonomy ID and the name."""

    identifier: str = Field(description="NCBI Taxonomy ID")
    name: str | None


class DatasetOrganism(Organism):
    biosample_count: int


class ParseResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str
    ast: dict[str, Any]
    labels: dict[str, str] = Field(description="Display labels of the term IDs and organism IDs used in the condition")


class SerializeRequest(ApiModel):
    ast: dict[str, Any]


class SelectRequest(ApiModel):
    q: str | None = None
    clauses: list[Clause] = Field(min_length=1)
    mode: Literal["toggle", "narrow"] = Field(
        default="toggle",
        description=(
            "`toggle` adds each clause, or removes the clauses when all of them are present. "
            "`narrow` adds each clause as a new AND conjunct."
        ),
    )


class KeywordRequest(ApiModel):
    q: str | None = None
    keyword: str = Field(
        description=(
            "Text as typed into a keyword box: words, and phrases in double quotes. An empty keyword removes the "
            "keywords of the condition."
        ),
    )


class ConditionResponse(ApiModel):
    dataset_version: DatasetVersionRef
    dsl: str | None = Field(description="The condition string")
    ast: dict[str, Any] | None
    labels: dict[str, str] = Field(description="Display labels of the term IDs and organism IDs used in the condition")


class Element(ApiModel):
    value: str
    label: str
    clauses: list[Clause]
    count: int


class TermElement(Element):
    count_exact: int
    count_selected: int
    has_children: bool = Field(
        description="Whether a direct child term has a count above 0 in the population of the list, in the unit"
    )
    parents: list[str] = Field(
        description="The elements of the same list that are direct parents of the term, in the order of the list"
    )


class DistributionResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str | None
    population_q: str | None = Field(description="The condition the counts were computed from")
    field: str
    unit: Unit
    facet_self_exclude: bool
    total: int = Field(description="Count of the population in the unit")
    elements: list[TermElement | Element]
    without_term: int | None = Field(
        default=None,
        description=(
            "For an annotation term dimension, the count of the population whose BioSamples have no term of the field: "
            "the population combined by AND with `NOT <field>_status:mapped`, in the unit"
        ),
    )


class Cell(ApiModel):
    row: str
    col: str
    count: int
    expected: float | None
    ratio: float | None = Field(
        description="The count divided by the expected count; null when the expected count is null or zero"
    )
    residual: float | None
    classification: Literal["gap", "under", "over"] | None


class CrosstabResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str | None
    population_q: str | None
    row_field: str
    col_field: str
    unit: Unit
    facet_self_exclude: bool
    total: int
    rows: list[TermElement | Element]
    cols: list[TermElement | Element]
    cells: list[Cell]


class TrendPoint(ApiModel):
    year: int
    count: int
    clauses: list[Clause]


class TrendSeries(ApiModel):
    value: str
    label: str
    clauses: list[Clause]
    points: list[TrendPoint]


class TrendResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str | None
    unit: Unit
    facet_self_exclude: bool
    years: list[int]
    total: list[TrendPoint] = Field(description="Counts of the condition per year")
    total_population_q: str | None = Field(description="The condition the counts of `total` were computed from")
    field: str | None = Field(description="The dimension of `series`, when the request names one")
    population_q: str | None = Field(description="The condition the counts of `series` were computed from")
    series: list[TrendSeries]


class Pagination(ApiModel):
    page: int
    per_page: int
    total: int
    has_next: bool


class Project(ApiModel):
    identifier: str = Field(description="BioProject accession")
    title: str | None
    biosample_count: int
    experiment_count: int
    assays: list[str]
    clauses: list[Clause]


class ProjectsResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str | None
    population_q: str | None
    facet_self_exclude: bool
    sort: str
    pagination: Pagination
    items: list[Project]


class AnnotationValue(ApiModel):
    value: str | None
    status: str
    term_id: str | None
    label: str | None


class EntryItem(ApiModel):
    identifier: str = Field(description="BioSample accession")
    type: EntryType
    experiments: list[str] = Field(description="Experiments of the BioSample that match the condition")
    title: str | None
    organism: Organism | None
    library_strategy: list[str]
    bioprojects: list[str]
    date_published: str | None
    chip_atlas: list[str] = Field(description="Genome assemblies under which ChIP-Atlas processed the experiments")
    annotations: dict[str, list[AnnotationValue]]


class EntriesResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str | None
    type: EntryType
    pagination: Pagination
    items: list[EntryItem]


class Evidence(ApiModel):
    attribute: str = Field(description="Attribute name, or `title` for the BioSample title")
    attribute_index: int = Field(description="Position in `attributes`, or -1 for the title")
    start: int
    end: int
    method: str


class EntryAnnotation(ApiModel):
    field: str
    value: str | None
    status: str
    term_id: str | None
    label: str | None
    evidence: list[Evidence]


class EntryExperiment(ApiModel):
    accession: str
    library_strategy: str | None
    in_population: bool
    runs: list[str]
    chip_atlas: list[str]


class EntryBioProject(ApiModel):
    accession: str
    title: str | None


class Attribute(ApiModel):
    name: str
    value: str
    harmonized_name: str | None


class EntryResponse(ApiModel):
    dataset_version: DatasetVersionRef
    identifier: str = Field(description="BioSample accession")
    type: Literal["biosample"]
    title: str | None
    organism: Organism | None
    date_published: str | None
    run: str
    attributes: list[Attribute]
    annotations: list[EntryAnnotation]
    experiments: list[EntryExperiment]
    bioprojects: list[EntryBioProject]


class TermHit(ApiModel):
    field: str
    term_id: str
    label: str | None
    ontology: str
    path: list[str] = Field(description="Labels of the ancestors along one path from a root, nearest last")
    descendant_count: int = Field(description="Descendant terms annotated in the population")
    count: int
    matched_synonym: str | None = Field(
        description=(
            "The synonym that decides the match: a synonym equal to the query, or the synonym that contains the query "
            "when neither the label nor the ID contains it"
        )
    )
    clauses: list[Clause]


class TermsResponse(ApiModel):
    dataset_version: DatasetVersionRef
    field: str | None = Field(description="The searched field, or null when every annotation field was searched")
    query: str
    population_q: str | None = Field(
        description="The condition the counts were computed from, or null when every annotation field was searched"
    )
    unit: Unit
    terms: list[TermHit]


class TermChildrenResponse(ApiModel):
    dataset_version: DatasetVersionRef
    field: str
    term_id: str
    population_q: str | None
    unit: Unit
    children: list[TermElement]


class ServiceInfoResponse(ApiModel):
    name: str
    version: str = Field(description="Package version, followed by `+<commit>` when the build records a commit")
    description: str
    store: Literal["ok", "unavailable"]
