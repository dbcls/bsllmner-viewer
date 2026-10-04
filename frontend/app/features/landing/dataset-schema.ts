import { exportEntriesUrl } from "~/lib/api/client"
import type { DatasetResponse } from "~/lib/api/types"
import { ANNOTATION_CRATE } from "~/lib/crate"
import { formatCount } from "~/lib/format"
import { assayList, fieldLabel } from "~/lib/labels"

/** The name of the dataset, after the name of the site in the heading of the top page. */
export const DATASET_NAME = "Ontology-annotated BioSamples"

/** The exports of every BioSample, which are the downloads of the Dataset, with their media types. */
const DOWNLOADS = [
  { format: "ndjson", encodingFormat: "application/x-ndjson" },
  { format: "tsv", encodingFormat: "text/tab-separated-values" },
] as const

/**
 * The schema.org Dataset of the top page. The Dataset is the annotations of the RO-Crate, so its creator and its license
 * are those of the RO-Crate. The description of the Dataset says that the license is that of the annotations, and where
 * the rest of the data comes from. The URLs in the Dataset use the host that serves the page.
 */
export const datasetSchema = (dataset: DatasetResponse, origin: string) => {
  const { name, createdAt, model } = dataset.datasetVersion
  const address = (path: string) => new URL(path, origin).href
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: DATASET_NAME,
    description: [
      `Annotations of ${formatCount(dataset.totals.biosample)} public BioSamples with ${assayList(dataset.targetAssays)} experiments.`,
      "bsllmner-mk2 extracted values such as the cell line, the tissue, and the disease from the attributes of each BioSample",
      "with a large language model, and mapped each value to an ontology term.",
      `The annotations are published in the RO-Crate ${ANNOTATION_CRATE.name} under ${ANNOTATION_CRATE.license.name}.`,
      "The metadata of the BioSamples, and their links to SRA Experiments and BioProjects, come from the INSDC databases at NCBI and DDBJ.",
    ].join(" "),
    url: address("/"),
    version: name,
    dateModified: createdAt,
    creator: { "@type": "Organization", name: ANNOTATION_CRATE.creator.name, url: ANNOTATION_CRATE.creator.url },
    license: ANNOTATION_CRATE.license.url,
    isBasedOn: ANNOTATION_CRATE.url,
    isAccessibleForFree: true,
    measurementTechnique: `Extraction of values from BioSample attributes with the large language model ${model} (bsllmner-mk2), and mapping of each value to an ontology term`,
    variableMeasured: dataset.fields.map((field) => fieldLabel(field.name)),
    distribution: DOWNLOADS.map(({ format, encodingFormat }) => ({
      "@type": "DataDownload",
      encodingFormat,
      contentUrl: address(exportEntriesUrl("biosample", null, format)),
    })),
  }
}
