import type { WorkspaceState } from "./workspace-state"

export type Preset = {
  id: string
  title: string
  /** What the opened view lets the reader see, in one line. */
  description?: string
  /**
   * The values of the condition, one short text per clause in the order they are written: the label of a term, the name
   * of an organism, or the value itself. Written here with the condition, since the labels do not change within a dataset.
   */
  values?: string[]
  state: Partial<WorkspaceState>
}

export const MATRIX_PRESETS: Preset[] = [
  {
    id: "disease-tissue",
    title: "Disease × Tissue",
    description: "Which tissues are sampled for each disease, and which pairs no BioProject covers.",
    state: { tab: "heatmap", row: "disease", col: "tissue", unit: "bioproject" },
  },
  {
    id: "cell-type-tissue",
    title: "Cell type × Tissue",
    description: "Which cell types are sampled from each tissue, and how many independent BioProjects cover each pair.",
    state: { tab: "heatmap", row: "cell_type", col: "tissue", unit: "bioproject" },
  },
  {
    id: "cell-line-assay",
    title: "Cell line × Assay",
    description: "Independent BioProjects per cell line and assay. Find cell lines with ChIP-Seq but no Bisulfite-Seq.",
    state: { tab: "heatmap", row: "cell_line", col: "library_strategy", q: "organism_id:9606", unit: "bioproject" },
  },
]

export const QUESTION_PRESETS: Preset[] = [
  {
    id: "atac-breast-cancer",
    title: "How many independent projects have ATAC-seq data for breast cancer?",
    state: { tab: "projects", q: 'disease:"MONDO:0007254" AND library_strategy:ATAC-seq', unit: "bioproject" },
    values: ["breast cancer", "ATAC-seq"],
  },
  {
    id: "hepg2-doxorubicin",
    title: "Is there public RNA-Seq of HepG2 treated with doxorubicin?",
    state: { tab: "samples", q: 'cell_line:"CVCL:0027" AND drug:"CHEBI:28748" AND library_strategy:RNA-Seq' },
    values: ["Hep-G2", "doxorubicin", "RNA-Seq"],
  },
  {
    id: "tp53-knockout",
    title: "In which cell lines has TP53 been knocked out?",
    state: { tab: "distribution", q: 'knockout_gene:"NCBIGene:7157"' },
    values: ["TP53"],
  },
  {
    id: "esc-bisulfite-knockouts",
    title: "Which genes have been knocked out in embryonic stem cells with Bisulfite-Seq data?",
    state: { tab: "distribution", q: 'cell_type:"CL:0002322" AND library_strategy:Bisulfite-Seq', unit: "bioproject" },
    values: ["embryonic stem cell", "Bisulfite-Seq"],
  },
]
