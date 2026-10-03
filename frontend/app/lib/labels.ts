/** Display names for api identifiers. The api is the source of the identifiers themselves. */

export const FIELD_LABELS: Record<string, string> = {
  cell_line: "Cell line",
  cell_type: "Cell type",
  tissue: "Tissue",
  disease: "Disease",
  drug: "Drug",
  knockout_gene: "Knockout gene",
  knockdown_gene: "Knockdown gene",
  overexpressed_gene: "Overexpressed gene",
  chip_antigen: "ChIP antigen",
  library_strategy: "Assay",
  organism_id: "Organism",
  date_published: "Year",
  bioproject: "BioProject",
}

export const fieldLabel = (field: string): string => {
  if (field in FIELD_LABELS) return FIELD_LABELS[field] ?? field
  if (field.endsWith("_status")) return `${fieldLabel(field.slice(0, -"_status".length))} status`
  return field.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
}

/** The name of an ontology by its prefix, from the ontologies that the dataset describes, or the prefix itself. */
export const ontologyName = (prefix: string, ontologies: readonly { prefix: string; name: string }[]): string =>
  ontologies.find((ontology) => ontology.prefix === prefix)?.name ?? prefix

export const ontologyOfTerm = (termId: string): string => termId.split(":")[0] ?? termId

export type StatusCode =
  | "mapped_exact"
  | "mapped_selected"
  | "unmapped_no_candidate"
  | "unmapped_rejected"
  | "not_stated"
  | "extraction_failed"

export type StatusGroup = "mapped" | "unmapped" | "no_value"

export type StatusInfo = {
  label: string
  group: StatusGroup
  /** What the status says about the annotation, in one sentence for the help of the screens that show it. */
  meaning: string
}

export const STATUS_INFO: Record<StatusCode, StatusInfo> = {
  mapped_exact: { label: "Exact match", group: "mapped", meaning: "The value matched an ontology label or synonym exactly." },
  mapped_selected: { label: "LLM selected", group: "mapped", meaning: "The LLM selected the term from the candidate terms." },
  unmapped_no_candidate: { label: "No candidate", group: "unmapped", meaning: "No ontology term resembled the value." },
  unmapped_rejected: { label: "Rejected", group: "unmapped", meaning: "Similar terms existed, but the LLM adopted none." },
  not_stated: { label: "Not stated", group: "no_value", meaning: "No value was extracted for the field." },
  extraction_failed: { label: "Extraction failed", group: "no_value", meaning: "The output of the LLM could not be read, so no field has a value." },
}

export const STATUS_ORDER: StatusCode[] = [
  "mapped_exact",
  "mapped_selected",
  "unmapped_no_candidate",
  "unmapped_rejected",
  "not_stated",
  "extraction_failed",
]

export const GROUP_LABELS: Record<StatusGroup, string> = {
  mapped: "Mapped",
  unmapped: "Unmapped",
  no_value: "No value",
}

export const statusInfo = (status: string): StatusInfo =>
  STATUS_INFO[status as StatusCode] ?? { label: status, group: "no_value", meaning: "" }

export const statusLabel = (value: string): string =>
  value in GROUP_LABELS ? GROUP_LABELS[value as StatusGroup] : statusInfo(value).label

export const UNIT_LABELS: Record<string, string> = {
  biosample: "BioSamples",
  "sra-experiment": "SRA Experiments",
  bioproject: "BioProjects",
}

export const unitLabel = (unit: string): string => UNIT_LABELS[unit] ?? unit

/**
 * An organism by its NCBI Taxonomy scientific name, in full and in roman type. Names that are not binomials, such as
 * "mixed sample" or "Homo sapiens/Mus musculus xenograft", have no abbreviation or italic form.
 */
export const organismLabel = (id: string, name: string | null | undefined): string => name ?? id
