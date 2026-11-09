/** An organization, named as it names itself in English, and its English site. */
export type Organization = { name: string; url: string }

/** The organization that runs bsllmner-mk2 and made the RO-Crates of the annotations. */
export const DBCLS: Organization = { name: "Database Division for Life Science (DBCLS)", url: "https://dbcls.rois.ac.jp/index-en.html" }

/** A license, with the address of its text. */
export type License = { name: string; url: string }

/** The license of the annotations, and of every RO-Crate except the ontology files in it. */
export const ANNOTATION_LICENSE: License = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" }

/** The related paper that the README of bsllmner-mk2 names. */
export const PAPER = { doi: "10.1101/2025.02.17.638570", url: "https://doi.org/10.1101/2025.02.17.638570" } as const

/** A person who made the RO-Crates, with the address of their ORCID record and the organizations they belong to. */
export type Author = { name: string; orcid: string; affiliations: readonly string[] }

const DBCLS_AFFILIATION =
  "Database Division for Life Science (DBCLS), BioData Science Initiative, National Institute of Genetics, Research Organization of Information and Systems"

/** The authors of the RO-Crates, as `ro-crate-metadata.json` of each RO-Crate names them. */
export const CRATE_AUTHORS: readonly Author[] = [
  { name: "Shuya Ikeda", orcid: "https://orcid.org/0000-0002-1357-5159", affiliations: [DBCLS_AFFILIATION] },
  { name: "Hirotaka Suetake", orcid: "https://orcid.org/0000-0003-2765-0049", affiliations: ["Sator Inc."] },
  {
    name: "Tazro Ohta",
    orcid: "https://orcid.org/0000-0003-3777-5945",
    affiliations: [
      DBCLS_AFFILIATION,
      "Department of Artificial Intelligence Medicine, Graduate School of Medicine, Chiba University",
      "Institute for Advanced Academic Research, Chiba University",
    ],
  },
]

/**
 * The ontologies whose files the RO-Crates hold under `ontology/`, with the license of those files. The files keep the
 * license of their ontology, which differs from the license of the annotations for some of them.
 */
export const CRATE_ONTOLOGIES: readonly { name: string; url: string; license: License }[] = [
  { name: "Cellosaurus", url: "https://www.cellosaurus.org/", license: ANNOTATION_LICENSE },
  { name: "Cell Ontology (CL)", url: "https://obofoundry.org/ontology/cl", license: ANNOTATION_LICENSE },
  {
    name: "Experimental Factor Ontology (EFO), the classes in the CL files",
    url: "https://www.ebi.ac.uk/efo/",
    license: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  },
  {
    name: "Uberon multi-species anatomy ontology (UBERON)",
    url: "https://obofoundry.org/ontology/uberon",
    license: { name: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" },
  },
  { name: "Mondo Disease Ontology (MONDO)", url: "https://obofoundry.org/ontology/mondo", license: ANNOTATION_LICENSE },
  { name: "Chemical Entities of Biological Interest (ChEBI)", url: "https://obofoundry.org/ontology/chebi", license: ANNOTATION_LICENSE },
  {
    name: "NCBI Gene",
    url: "https://www.ncbi.nlm.nih.gov/gene",
    license: { name: "Public domain", url: "https://www.ncbi.nlm.nih.gov/home/about/policies/" },
  },
]

/** The directories and the files at the root of every RO-Crate, with what each holds. */
export const CRATE_CONTENTS: readonly { path: string; description: string }[] = [
  {
    path: "results/",
    description:
      "One JSON Lines file for each source and year of publication, with one line for each BioSample: the extracted values, the values that have an ontology term with the term, and the BioSample record",
  },
  { path: "run-results/", description: "The result file of each run as the run wrote it, with the ontology candidates of each value and the timing of the run" },
  { path: "inputs/", description: "The BioSample records that the runs read" },
  { path: "ontology/", description: "The ontology files that the runs mapped the values to" },
  { path: "config/", description: "The configurations and the prompts of the runs" },
  { path: "logs/", description: "The logs of the batch that executed the runs" },
  { path: "provenance/", description: "The index of the runs, the record of how results/ was made, and the SHA-256 of every file (checksums.sha256)" },
  { path: "ro-crate-metadata.json", description: "The RO-Crate metadata, with the inputs, the code version, and the arguments of each run" },
  { path: "README.md", description: "The counts of the RO-Crate, and how its runs were executed" },
]

/** The directories at the root of every RO-Crate. The web server offers an archive of each. */
export const CRATE_PARTS = ["results", "run-results", "inputs", "ontology", "config", "logs", "provenance"] as const

export type CratePart = (typeof CRATE_PARTS)[number]

/** An RO-Crate of the annotations of one model. The counts are those of the README of the RO-Crate. */
export type Crate = {
  /** The fragment of the RO-Crate on the Datasets page. */
  id: string
  /**
   * The name under which the web server offers the RO-Crate: the name of its archive and of its directory. The name
   * ends with `datePublished`, and a release never changes, so an RO-Crate that is made again has another name.
   */
  release: string
  /** The model that made the annotations, as `datasetVersion.model` of the api names it. */
  model: string
  name: string
  description: string
  datePublished: string
  /** The distinct BioSamples. A BioSample in a ChIP-Atlas source and in an RNA-Seq source is counted once. */
  biosamples: number
  files: number
  /** The size of the files of the RO-Crate. */
  bytes: number
  /** The sizes that `bsllmner-viewer-package-crate` printed for the archive of the whole RO-Crate and for each directory. */
  archiveBytes: number
  partBytes: Readonly<Record<CratePart, number>>
  sources: readonly string[]
}

const CRATE_NAME = "Ontology-mapped named entities from ChIP-Atlas and RNA-Seq BioSample records"

const crateDescription = (biosamples: string) =>
  [
    `bsllmner-mk2 extracted named entities from the attributes of ${biosamples} public BioSamples of ChIP-Atlas (hg38 and mm10) and of human and mouse RNA-Seq experiments with a large language model, and mapped each value to an ontology term.`,
    "The reselect runs repeated the mapping of the gene fields for the values that the select runs left without a term.",
    "The RO-Crate holds the results with the inputs, the ontologies, the configurations, and the logs of every run.",
  ].join(" ")

/** The RO-Crates that the Datasets page lists, the RO-Crate of the served dataset first. */
export const CRATES: readonly Crate[] = [
  {
    id: "qwen3.8-27b",
    release: "bsllmner2-qwen38-ro-crate-2026-10-30",
    model: "qwen3.8:27b",
    name: CRATE_NAME,
    description: crateDescription("4,440,091"),
    datePublished: "2026-10-30",
    biosamples: 4440091,
    files: 1510,
    bytes: 53435958087,
    archiveBytes: 1705063916,
    partBytes: { results: 387529831, "run-results": 945166916, inputs: 338659843, ontology: 31152027, config: 4574, logs: 2158361, provenance: 196501 },
    sources: ["ChIP-Atlas (hg38, mm10)", "Human RNA-Seq (2008-01 to 2026-09)", "Mouse RNA-Seq (2008-01 to 2026-09)"],
  },
  {
    id: "mistral-small3.1-24b",
    release: "bsllmner2-mistral-ro-crate-2026-10-30",
    model: "mistral-small3.1:24b",
    name: CRATE_NAME,
    description: crateDescription("4,187,708"),
    datePublished: "2026-10-30",
    biosamples: 4187708,
    files: 1074,
    bytes: 53294965248,
    archiveBytes: 1776903190,
    partBytes: { results: 367272310, "run-results": 1057783160, inputs: 318668894, ontology: 31152027, config: 4574, logs: 1429701, provenance: 401522 },
    sources: ["ChIP-Atlas (hg38, mm10)", "Human RNA-Seq (2008-01 to 2026-03)", "Mouse RNA-Seq (2008-01 to 2026-05)"],
  },
]

/** The path of the archive of a whole RO-Crate, which unpacks into a directory named by its release. */
export const archivePath = (crate: Crate): string => `/datasets/${crate.release}.tar.gz`

/** The path of the archive of one directory of an RO-Crate, which keeps the paths from the root of the RO-Crate. */
export const partPath = (crate: Crate, part: CratePart): string => `/datasets/${crate.release}/${part}.tar.gz`

/** The path of a file that the web server offers without an archive, by its path in the RO-Crate. */
export const crateFilePath = (crate: Crate, path: string): string => `/datasets/${crate.release}/${path}`

/**
 * The commands that download the archive of an RO-Crate from the host, unpack it, and check every file against its
 * SHA-256. `-f` keeps the 404 page out of the archive, and `-C -` continues a download that stopped.
 */
export const downloadCommands = (crate: Crate, origin: string): string =>
  [
    `curl -f -C - -O ${new URL(archivePath(crate), origin).href}`,
    `tar xzf ${crate.release}.tar.gz`,
    `cd ${crate.release} && sha256sum -c provenance/checksums.sha256`,
  ].join("\n")

/** The RO-Crate of the annotations of a model, if the Datasets page lists one. */
export const crateOfModel = (model: string): Crate | undefined => CRATES.find((crate) => crate.model === model)

/** The path of an RO-Crate on the Datasets page, or of the Datasets page if no RO-Crate is given. */
export const datasetsPath = (crate?: Crate): string => (crate ? `/datasets#${crate.id}` : "/datasets")
