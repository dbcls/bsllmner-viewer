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
  date_created: "Year",
  bioproject: "BioProject",
  identifier: "Accession",
  title: "Title",
}

export const fieldLabel = (field: string): string => {
  if (field in FIELD_LABELS) return FIELD_LABELS[field] ?? field
  if (field.endsWith("_status")) return `${fieldLabel(field.slice(0, -"_status".length))} status`
  if (field.endsWith("_value")) return `${fieldLabel(field.slice(0, -"_value".length))} value`
  return field.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
}

export const ONTOLOGY_LABELS: Record<string, string> = {
  CVCL: "Cellosaurus",
  CL: "Cell Ontology",
  UBERON: "UBERON",
  MONDO: "MONDO",
  CHEBI: "ChEBI",
  NCBIGene: "NCBI Gene",
  EFO: "EFO",
  BFO: "BFO",
}

export const ontologyLabel = (prefix: string): string => ONTOLOGY_LABELS[prefix] ?? prefix

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
  glyph: string
  group: StatusGroup
}

export const STATUS_INFO: Record<StatusCode, StatusInfo> = {
  mapped_exact: { label: "Exact match", glyph: "●", group: "mapped" },
  mapped_selected: { label: "LLM selected", glyph: "◐", group: "mapped" },
  unmapped_no_candidate: { label: "No candidate", glyph: "○", group: "unmapped" },
  unmapped_rejected: { label: "Rejected", glyph: "⊘", group: "unmapped" },
  not_stated: { label: "Not stated", glyph: "–", group: "no_value" },
  extraction_failed: { label: "Extraction failed", glyph: "!", group: "no_value" },
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
  STATUS_INFO[status as StatusCode] ?? { label: status, glyph: "?", group: "no_value" }

export const statusLabel = (value: string): string =>
  value in GROUP_LABELS ? GROUP_LABELS[value as StatusGroup] : statusInfo(value).label

export const UNIT_LABELS: Record<string, string> = {
  biosample: "BioSamples",
  experiment: "Experiments",
  bioproject: "BioProjects",
}

export const unitLabel = (unit: string): string => UNIT_LABELS[unit] ?? unit

export const ORGANISM_SHORT: Record<string, string> = {
  "9606": "Human",
  "10090": "Mouse",
}

export const organismLabel = (id: string, name: string | null | undefined): string =>
  ORGANISM_SHORT[id] ?? name ?? id
