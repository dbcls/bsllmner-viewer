import { ANNOTATION_LICENSE, archivePath, type Crate, CRATE_AUTHORS, datasetsPath, DBCLS, PAPER } from "~/lib/crate"
import { formatSize } from "~/lib/format"

/**
 * The schema.org Dataset of an RO-Crate on the Datasets page. The creators are the authors of the RO-Crate, identified by
 * their ORCID, and the publisher is the organization that made the RO-Crates. The addresses of the Dataset and of its
 * download, the archive of the whole RO-Crate, use the host that serves the page.
 */
export const crateSchema = (crate: Crate, origin: string) => {
  const url = new URL(datasetsPath(crate), origin).href
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": url,
    name: `${crate.name} (${crate.model})`,
    description: crate.description,
    url,
    datePublished: crate.datePublished,
    license: ANNOTATION_LICENSE.url,
    isAccessibleForFree: true,
    creator: CRATE_AUTHORS.map((author) => ({
      "@type": "Person",
      "@id": author.orcid,
      name: author.name,
      affiliation: author.affiliations.map((name) => ({ "@type": "Organization", name })),
    })),
    publisher: { "@type": "Organization", name: DBCLS.name, url: DBCLS.url },
    citation: PAPER.url,
    measurementTechnique: `Extraction of values from BioSample attributes with the large language model ${crate.model} (bsllmner-mk2), and mapping of each value to an ontology term`,
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "application/gzip",
        contentUrl: new URL(archivePath(crate), origin).href,
        contentSize: formatSize(crate.archiveBytes),
      },
    ],
  }
}
