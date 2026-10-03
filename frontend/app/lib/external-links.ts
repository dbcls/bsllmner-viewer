/** The kinds of record that DDBJ Search and NCBI have a page for. */
export type RecordType = "biosample" | "bioproject" | "sra-experiment"

const NCBI_PATHS: Record<RecordType, string> = {
  biosample: "biosample",
  bioproject: "bioproject",
  "sra-experiment": "sra",
}

/** The page of a record in DDBJ Search. */
export const ddbjSearchHref = (type: RecordType, accession: string): string => `https://ddbj.nig.ac.jp/search/entry/${type}/${accession}`

/** The page of a record at NCBI. */
export const ncbiHref = (type: RecordType, accession: string): string => `https://www.ncbi.nlm.nih.gov/${NCBI_PATHS[type]}/${accession}`

/** The page of an SRA Experiment in ChIP-Atlas. */
export const chipAtlasHref = (accession: string): string => `https://chip-atlas.org/view?id=${accession}`

/** The NCBI Datasets page of an organism, by its NCBI Taxonomy ID. */
export const taxonomyHref = (identifier: string): string => `https://www.ncbi.nlm.nih.gov/datasets/taxonomy/${identifier}/`
