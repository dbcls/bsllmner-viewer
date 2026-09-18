import type { WorkspaceState } from "./workspace-state"

export type Preset = {
  id: string
  title: string
  description: string
  state: Partial<WorkspaceState>
}

export const MATRIX_PRESETS: Preset[] = [
  {
    id: "disease-tissue",
    title: "Disease × Tissue",
    description: "Which tissues are sampled for each disease, and where are the holes?",
    state: { tab: "heatmap", row: "disease", col: "tissue", unit: "bioproject" },
  },
  {
    id: "cell-line-antigen",
    title: "Cell line × ChIP antigen",
    description: "Which factors have been profiled in which lines (ChIP-Seq only).",
    state: { tab: "heatmap", row: "cell_line", col: "chip_antigen", q: "library_strategy:ChIP-Seq", unit: "experiment" },
  },
  {
    id: "cell-line-assay",
    title: "Cell line × Assay",
    description: "Independent projects per line and assay — spot lines with RNA-Seq but no ATAC-seq.",
    state: { tab: "heatmap", row: "cell_line", col: "library_strategy", q: "organism_id:9606", unit: "bioproject" },
  },
  {
    id: "disease-drug",
    title: "Disease × Drug",
    description: "Drug perturbations per disease context.",
    state: { tab: "heatmap", row: "disease", col: "drug", unit: "biosample" },
  },
]

export const QUESTION_PRESETS: Preset[] = [
  {
    id: "atac-breast-cancer",
    title: "How many independent projects have ATAC-seq data for breast cancer?",
    description: "Projects",
    state: { tab: "projects", q: 'disease:"MONDO:0007254" AND library_strategy:ATAC-seq', unit: "bioproject" },
  },
  {
    id: "hepg2-doxorubicin",
    title: "Is there public RNA-Seq of HepG2 treated with doxorubicin?",
    description: "Samples",
    state: { tab: "samples", q: 'cell_line:"CVCL:0027" AND drug:"CHEBI:28748" AND library_strategy:RNA-Seq' },
  },
  {
    id: "rna-no-atac",
    title: "For which cell lines do we have RNA-Seq but no ATAC-seq?",
    description: "Heatmap",
    state: { tab: "heatmap", row: "cell_line", col: "library_strategy", q: "organism_id:9606", unit: "bioproject" },
  },
  {
    id: "t2d-tissues",
    title: "Which tissues are under-represented for type 2 diabetes?",
    description: "Distribution",
    state: { tab: "distribution", q: 'disease:"MONDO:0005148"', unit: "bioproject" },
  },
]
