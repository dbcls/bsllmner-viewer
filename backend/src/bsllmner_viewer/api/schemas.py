"""Response and request models of the api."""

from __future__ import annotations

from typing import Annotated, Any, Literal, NotRequired, TypedDict, Union

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer
from pydantic.alias_generators import to_camel

from bsllmner_viewer.dsl.fields import FieldKind, GroupName, Operator, Status
from bsllmner_viewer.dsl.parser import MAX_LENGTH
from bsllmner_viewer.dsl.validator import MAX_NODES
from bsllmner_viewer.store.metadata import EvidenceStrategy, MetadataKind

ClauseJson = TypedDict(
    "ClauseJson", {"field": str, "value": NotRequired[str], "from": NotRequired[str], "to": NotRequired[str]}
)

# The longest accepted value of a text that a client sends: a condition, a keyword, a search text, or a clause value.
# The names of fields, elements, and terms, and the accessions, are far shorter.
TEXT_MAX_LENGTH = MAX_LENGTH
CLAUSES_MAX_ITEMS = MAX_NODES
NAME_MAX_LENGTH = 256
MAX_ELEMENTS = 100
ACCESSION_MAX_LENGTH = 64

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

    name: str = Field(description="Name of the dataset version")
    created_at: str = Field(description="Time when the store was built, ISO 8601")
    model: str = Field(description="The model that the bsllmner-mk2 runs of the dataset used")
    digest: str = Field(description="Short hash of the full version information")


class Clause(ApiModel):
    """One DSL clause, as `field` with `value` or with a date range `from`/`to`."""

    field: str = Field(max_length=NAME_MAX_LENGTH)
    value: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    from_: str | None = Field(default=None, alias="from", max_length=TEXT_MAX_LENGTH)
    to: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)

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
    name: str = Field(description="Annotation field name, the `<field>` of `<field>_status`")
    multi_valued: bool = Field(description="Whether a BioSample can hold several values in the field")
    ontologies: list[str] = Field(description="Prefixes of the term IDs that the field uses")
    mapped_biosample_count: int = Field(description="BioSamples of the whole population with a term of the field")


class DatasetOntology(ApiModel):
    prefix: str = Field(description="Prefix of term IDs")
    name: str = Field(description="Name of the ontology that the prefix names")


class DatasetAssay(ApiModel):
    name: str = Field(description="Target assay, as a `library_strategy` value")
    biosample_count: int = Field(description="BioSamples of the whole population with an experiment of the assay")


class DslFieldDescription(ApiModel):
    name: str = Field(description="Field name to use in a condition")
    kind: FieldKind = Field(
        description="Kind of the field. A field of kind `term`, `assay`, `organism`, or `date` can be a dimension"
    )
    operators: list[Operator] = Field(description="`eq` for `field:value`, `between` for `field:[a TO b]`")


class Totals(ApiModel):
    biosample: int = Field(description="BioSamples of the whole population")
    experiment: int = Field(description="SRA Experiments of the whole population")
    bioproject: int = Field(description="BioProjects linked to the BioSamples of the whole population")


class DatasetResponse(ApiModel):
    dataset_version: DatasetVersionRef
    version: dict[str, Any] = Field(description="Full dataset version information")
    target_assays: list[str] = Field(
        description="Target assays of the dataset. They are the values that `library_strategy` accepts in a condition"
    )
    assays: list[DatasetAssay] = Field(description="Target assays in descending order of their BioSamples")
    fields: list[FieldDescription] = Field(description="Annotation fields, in the order of the select configuration")
    dsl_fields: list[DslFieldDescription] = Field(description="Every field that a condition can name")
    statuses: dict[GroupName, list[Status]] = Field(
        description=(
            "Status groups and the statuses under them. A condition names a group. An entry and an export report the "
            "status of each annotation"
        )
    )
    totals: Totals = Field(description="Counts of the whole population in each counting unit")
    organisms: list[DatasetOrganism] = Field(
        description="Organisms of the population in descending order of their BioSamples"
    )
    ontologies: list[DatasetOntology] = Field(description="Names of the prefixes of the terms of the dataset")


class Organism(ApiModel):
    """An organism as the NCBI Taxonomy ID and the name."""

    identifier: str = Field(description="NCBI Taxonomy ID")
    name: str | None = Field(description="Name of the organism; null when no name is known")


class DatasetOrganism(Organism):
    biosample_count: int = Field(description="BioSamples of the whole population of the organism")


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
    q: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    clauses: list[Clause] = Field(min_length=1, max_length=CLAUSES_MAX_ITEMS)
    mode: Literal["toggle", "narrow"] = Field(
        default="toggle",
        description=(
            "`toggle` adds each clause, or removes the clauses when all of them are present. "
            "`narrow` adds each clause as a new AND conjunct."
        ),
    )


class KeywordRequest(ApiModel):
    q: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    keyword: str = Field(
        max_length=TEXT_MAX_LENGTH,
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
    value: str = Field(description="The element: a term ID, a target assay, an NCBI Taxonomy ID, or a year")
    label: str = Field(description="Name to show for the element")
    clauses: list[Clause] = Field(description="The clauses that select what the element counts")
    count: int = Field(description="Count of the units that have the element, in the unit of the request")


class TermElement(Element):
    count_exact: int = Field(
        description="Count of the units that have the term or a descendant with a `mapped_exact` annotation"
    )
    count_selected: int = Field(
        description="Count of the units that have the term or a descendant with a `mapped_selected` annotation"
    )
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
    facet_self_exclude: bool = Field(description="The value of the request parameter")
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
    row: str = Field(description="Element of the row")
    col: str = Field(description="Element of the column")
    count: int = Field(description="Count of the units that have both elements")
    expected: float | None = Field(
        description="Count that the cell would have if the dimensions were independent; null when the total is zero"
    )
    ratio: float | None = Field(
        description="The count divided by the expected count; null when the expected count is null or zero"
    )
    residual: float | None = Field(
        description="Adjusted standardized residual of the count against the expected count; null when undefined"
    )
    classification: Literal["gap", "under", "over"] | None = Field(
        description="`gap`, `under` (under-represented), `over` (over-represented), or null when not classified"
    )


class CrosstabResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str | None
    population_q: str | None = Field(description="The condition the counts were computed from")
    row_field: str
    col_field: str
    unit: Unit
    facet_self_exclude: bool
    total: int = Field(description="Count of the population in the unit, the `N` of the expected counts")
    rows: list[TermElement | Element]
    cols: list[TermElement | Element]
    cells: list[Cell]


class TrendPoint(ApiModel):
    year: int
    count: int = Field(
        description="Count, in the unit of the request, of the matches whose BioSample was published in the year"
    )
    clauses: list[Clause]


class TrendSeries(ApiModel):
    value: str = Field(description="The element of the series dimension")
    label: str = Field(description="Name to show for the element")
    clauses: list[Clause]
    points: list[TrendPoint]


class TrendResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str | None
    unit: Unit
    facet_self_exclude: bool
    years: list[int] = Field(description="The years of every list of this response, in ascending order")
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
    total: int = Field(description="Count of all items of the list in its counting unit, not only of this page")
    has_next: bool = Field(description="Whether a page after this one has items")

    @classmethod
    def of(cls, page: int, per_page: int, total: int) -> Pagination:
        return cls(page=page, per_page=per_page, total=total, has_next=page * per_page < total)


class Project(ApiModel):
    identifier: str = Field(description="BioProject accession")
    title: str | None
    biosample_count: int = Field(description="BioSamples of the BioProject in the population")
    experiment_count: int = Field(description="SRA Experiments of the BioProject in the population")
    assays: list[str] = Field(description="Assays of those SRA Experiments, in ascending order")
    clauses: list[Clause]


class ProjectsResponse(ApiModel):
    dataset_version: DatasetVersionRef
    q: str | None
    population_q: str | None
    facet_self_exclude: bool
    sort: ProjectSort = Field(description="The order of the items")
    pagination: Pagination
    items: list[Project]


class AnnotationValue(ApiModel):
    value: str | None = Field(description="The extracted value; null when none was extracted")
    status: Status
    term_id: str | None = Field(description="ID of the mapped term; null when the value has no term")
    label: str | None = Field(description="Label of the mapped term; null when the value has no term")


class EntryItem(ApiModel):
    identifier: str = Field(description="BioSample accession")
    type: EntryType
    experiments: list[str] = Field(description="SRA Experiments of the BioSample that match the condition")
    title: str | None
    organism: Organism | None
    library_strategy: list[str] = Field(description="Assays of the matching experiments")
    bioprojects: list[str] = Field(description="Accessions of the BioProjects of the BioSample")
    date_published: str | None = Field(description="Publication date, `YYYY-MM-DD`")
    chip_atlas: list[str] = Field(description="Genome assemblies under which ChIP-Atlas processed the experiments")
    annotations: dict[str, list[AnnotationValue]] = Field(description="Annotations per annotation field name")


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
    field: str = Field(description="Annotation field name")
    value: str | None = Field(description="The extracted value; null when none was extracted")
    status: Status
    term_id: str | None = Field(description="ID of the mapped term; null when the value has no term")
    label: str | None = Field(description="Label of the mapped term; null when the value has no term")
    clauses: list[Clause] = Field(description="The clause on the field and the term; empty without a term")
    evidence: list[Evidence]


class EntryExperiment(ApiModel):
    accession: str = Field(description="SRA Experiment accession")
    library_strategy: str | None
    in_population: bool = Field(description="Whether the experiment is in the population")
    runs: list[str] = Field(description="Accessions of the SRA Runs of the experiment")
    chip_atlas: list[str] = Field(description="Genome assemblies under which ChIP-Atlas processed the experiment")


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
    run: str = Field(description="Name of the bsllmner-mk2 run that analyzed the BioSample. It is not an SRA Run")
    metadata: list[MetadataItem] = Field(
        description=(
            "Original metadata in the order of the description, the record, and the attributes. "
            "`metadataIndex` of an evidence is a position in this list"
        )
    )
    annotations: list[EntryAnnotation]
    experiments: list[EntryExperiment]
    bioprojects: list[EntryBioProject]


class TermHit(ApiModel):
    field: str = Field(description="Annotation field of the hit")
    term_id: str = Field(description="ID of the term, to use in a condition on the field")
    label: str | None
    ontology: str = Field(description="Name of the ontology of the term")
    path: list[str] = Field(description="Labels of the ancestors along one path from a root, nearest last")
    descendant_count: int = Field(
        description="Descendant terms annotated in the field in the whole dataset, whatever `q` is"
    )
    count: int = Field(
        description="Count of the units in the population of the field that have the term or a descendant"
    )
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
    store: Literal["ok", "unavailable"] = Field(
        description="`unavailable` when the api cannot query the store, or the store file changed since it was opened"
    )


class TermOntology(ApiModel):
    prefix: str = Field(description="Prefix of the term ID")
    name: str = Field(description="Name of the ontology that the prefix names")


class TermParent(ApiModel):
    term_id: str = Field(description="ID of the parent term")
    label: str | None


class TermResponse(ApiModel):
    dataset_version: DatasetVersionRef
    term_id: str = Field(description="ID of the term")
    label: str | None
    ontology: TermOntology | None = Field(description="Null for a term ID without a prefix")
    synonyms: list[str] = Field(
        description="Synonyms that differ from the label and from each other beyond letter case"
    )
    parents: list[TermParent] = Field(description="Direct parent terms in the dataset, in the order of their labels")
    url: str | None = Field(description="Page of the term on the site of its ontology; null for an unlisted prefix")
