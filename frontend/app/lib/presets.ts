import type { WorkspaceState } from "./workspace-state"

export type Preset = {
  id: string
  title: string
  state: Partial<WorkspaceState>
}

export const MATRIX_PRESETS: Preset[] = [
  {
    id: "disease-tissue",
    title: "Disease × Tissue",
    state: { tab: "heatmap", row: "disease", col: "tissue", unit: "bioproject" },
  },
  {
    id: "cell-line-antigen",
    title: "Cell line × ChIP antigen",
    state: {
      tab: "heatmap",
      row: "cell_line",
      col: "chip_antigen",
      q: "library_strategy:ChIP-Seq AND organism_id:9606",
      unit: "experiment",
    },
  },
  {
    id: "cell-line-assay",
    title: "Cell line × Assay",
    state: { tab: "heatmap", row: "cell_line", col: "library_strategy", q: "organism_id:9606", unit: "bioproject" },
  },
  {
    id: "disease-assay",
    title: "Disease × Assay",
    state: { tab: "heatmap", row: "disease", col: "library_strategy", unit: "bioproject" },
  },
]

export const QUESTION_PRESETS: Preset[] = [
  {
    id: "atac-breast-cancer",
    title: "How many independent projects have ATAC-seq data for breast cancer?",
    state: { tab: "projects", q: 'disease:"MONDO:0007254" AND library_strategy:ATAC-seq', unit: "bioproject" },
  },
  {
    id: "hepg2-doxorubicin",
    title: "Is there public RNA-Seq of HepG2 treated with doxorubicin?",
    state: { tab: "samples", q: 'cell_line:"CVCL:0027" AND drug:"CHEBI:28748" AND library_strategy:RNA-Seq' },
  },
  {
    id: "tp53-knockout",
    title: "In which cell lines has TP53 been knocked out?",
    state: { tab: "distribution", q: 'knockout_gene:"NCBIGene:7157"' },
  },
  {
    id: "t2d-tissues",
    title: "Which tissues have been sampled for type 2 diabetes?",
    state: { tab: "distribution", q: 'disease:"MONDO:0005148"', unit: "bioproject" },
  },
]
