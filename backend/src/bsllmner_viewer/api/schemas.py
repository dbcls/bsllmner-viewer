"""Response and request models of the api."""

from __future__ import annotations

from typing import Annotated, Any, Literal, NotRequired, TypedDict, Union

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer
from pydantic.alias_generators import to_camel

from bsllmner_viewer.dsl.fields import FieldKind, GroupName, Operator, Status
from bsllmner_viewer.store.metadata import EvidenceStrategy, MetadataKind

ClauseJson = TypedDict(
    "ClauseJson", {"field": str, "value": NotRequired[str], "from": NotRequired[str], "to": NotRequired[str]}
)

type Unit = Literal["biosample", "sra-experiment", "bioproject"]
type EntryType = Literal["biosample"]
type AccessionType = Literal["biosample", "sra-experiment", "sra-run", "bioproject"]
type ProjectSort = Literal[
    "biosampleCount:desc",
    "biosampleCount:asc",
    "experimentCount:desc",
    "experimentCount:asc",
]


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


class AstModel(BaseModel):
    """Base of the AST nodes. The property names are those of the DDBJ Search API, so they stay snake_case."""

    model_config = ConfigDict(extra="forbid", validate_by_name=True, serialize_by_alias=True)


class AstBool(AstModel):
    op: Literal["AND", "OR", "NOT"]
    rules: list[AstNode] = Field(min_length=1, description="Operands. `NOT` has exactly one")


class AstEq(AstModel):
    field: str
    op: Literal["eq"]
    value: str


class AstBetween(AstModel):
    field: str
    op: Literal["between"]
    from_: str = Field(alias="from")
    to: str


class AstFreeText(AstModel):
    op: Literal["free_text"]
    value: str
    is_phrase: bool


AstNode = Annotated[Union[AstBool, AstEq, AstBetween, AstFreeText], Field(discriminator="op")]  # noqa: UP007
AstBool.model_rebuild()


class FieldDescription(ApiModel):
    name: str
    multi_valued: bool
    ontologies: list[str]
    mapped_biosample_count: int = Field(description="BioSamples of the whole population with a term of the field")


class DatasetOntology(ApiModel):
    prefix: str = Field(description="Prefix of term IDs")
    name: str = Field(description="Name of the ontology that the prefix names")


class DatasetAssay(ApiModel):
    name: str = Field(description="Target assay, as a `library_strategy` value")
    biosample_count: int = Field(description="BioSamples of the whole population with an experiment of the assay")


class DslFieldDescription(ApiModel):
    name: str
    kind: FieldKind
    operators: list[Operator]


class Totals(ApiModel):
    biosample: int
    experiment: int
    bioproject: int


class DatasetResponse(ApiModel):
    dataset_version: DatasetVersionRef
    version: dict[str, Any] = Field(description="Full dataset version information")
    target_assays: list[str]
    assays: list[DatasetAssay] = Field(description="Target assays in descending order of their BioSamples")
    fields: list[FieldDescription]
    dsl_fields: list[DslFieldDescription]
    statuses: dict[GroupName, list[Status]] = Field(description="Status groups and the statuses under them")
    totals: Totals
    organisms: list[DatasetOrganism]
    ontologies: list[DatasetOntology] = Field(description="Names of the prefixes of the terms of the dataset")


class Organism(ApiModel):
    """An organism as the NCBI Taxonomy ID and the name."""

    identifier: str = Field(description="NCBI Taxonomy ID")
    name: str | None


class DatasetOrganism(Organism):
    biosample_count: int


_SELECTED_DESCRIPTION = (
    "The clauses that `POST /api/dsl/select` treats as already present in `toggle` mode: the top-level clauses and "
    "the clauses of a top-level OR on one field, outside any NOT. When every clause of an element is in this list, "
    "selecting the element removes the clauses"
)
_KEYWORD_DESCRIPTION = (
    "The text of a keyword box for the top-level keywords of the condition: the words, then the phrases in double "
    "quotes. `POST /api/dsl/keyword` reads it back as the same keywords"
)


class ParseResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str
    ast: AstNode
    labels: dict[str, str] = Field(description="Display labels of the term IDs and organism IDs used in the condition")
    selected: list[Clause] = Field(description=_SELECTED_DESCRIPTION)
    keyword: str = Field(description=_KEYWORD_DESCRIPTION)


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
    ast: AstNode | None
    labels: dict[str, str] = Field(description="Display labels of the term IDs and organism IDs used in the condition")
    selected: list[Clause] = Field(description=_SELECTED_DESCRIPTION)
    keyword: str = Field(description=_KEYWORD_DESCRIPTION)


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
    first_year: int | None = Field(description="The first year with a match, whatever `yearFrom` is")
    last_year: int | None = Field(description="The last year with a match, whatever `yearTo` is")
    total: list[TrendPoint] = Field(description="Counts of the condition per year")
    total_population_q: str | None = Field(description="The condition the counts of `total` were computed from")
    all_entries: list[TrendPoint] = Field(description="Counts of the whole population per year, without the condition")
    field: str | None = Field(description="The dimension of `series`, when the request names one")
    population_q: str | None = Field(description="The condition the counts of `series` were computed from")
    series: list[TrendSeries]


class Pagination(ApiModel):
    page: int
    per_page: int
    total: int
    has_next: bool

    @classmethod
    def of(cls, page: int, per_page: int, total: int) -> Pagination:
        return cls(page=page, per_page=per_page, total=total, has_next=page * per_page < total)


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
    sort: ProjectSort
    pagination: Pagination
    items: list[Project]


class AnnotationValue(ApiModel):
    value: str | None
    status: Status
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
    name: str = Field(description="Name of the item of the original metadata that the evidence is in")
    metadata_index: int = Field(description="Position of that item in `metadata`")
    in_name: bool = Field(description="True if the evidence is in the name of an attribute, false if in the value")
    start: int = Field(
        description="Unicode code point offset of the first code point of the match in that name or value as stored"
    )
    end: int = Field(
        description="Unicode code point offset after the last code point of the match in that name or value as stored"
    )
    strategy: EvidenceStrategy = Field(description="The matching strategy that found the evidence")


class EntryAnnotation(ApiModel):
    field: str
    value: str | None
    status: Status
    term_id: str | None
    label: str | None
    clauses: list[Clause] = Field(description="The clause on the field and the term; empty without a term")
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


class MetadataItem(ApiModel):
    kind: MetadataKind
    name: str = Field(description="Name to show: a description name, an attribute name, or a short name of a path")
    value: str
    harmonized_name: str | None = Field(description="Harmonized name of an attribute; null for the other kinds")


class EntryResponse(ApiModel):
    dataset_version: DatasetVersionRef
    identifier: str = Field(description="BioSample accession")
    type: Literal["biosample"]
    title: str | None
    organism: Organism | None
    date_published: str | None
    run: str
    metadata: list[MetadataItem] = Field(description="Original metadata: the description, attributes, and record")
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


class TermOntology(ApiModel):
    prefix: str = Field(description="Prefix of the term ID")
    name: str = Field(description="Name of the ontology that the prefix names")


class TermParent(ApiModel):
    term_id: str
    label: str | None


class TermResponse(ApiModel):
    dataset_version: DatasetVersionRef
    term_id: str
    label: str | None
    ontology: TermOntology | None = Field(description="Null for a term ID without a prefix")
    synonyms: list[str] = Field(
        description="Synonyms that differ from the label and from each other beyond letter case"
    )
    parents: list[TermParent] = Field(description="Direct parent terms in the dataset, in the order of their labels")
    url: str | None = Field(description="Page of the term on the site of its ontology; null for an unlisted prefix")
