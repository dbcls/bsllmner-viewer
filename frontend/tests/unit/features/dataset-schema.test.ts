import { describe, expect, it } from "vitest"

import { datasetSchema } from "~/features/landing/dataset-schema"
import type { DatasetResponse } from "~/lib/api/types"
import { ANNOTATION_CRATE } from "~/lib/crate"

const DATASET = {
  datasetVersion: { name: "full", createdAt: "2026-10-03T21:29:30Z", model: "mistral-small3.1:24b", digest: "0f8b06f33b9f2567" },
  targetAssays: ["RNA-Seq", "ChIP-Seq"],
  fields: [{ name: "cell_line" }, { name: "chip_antigen" }],
  totals: { biosample: 4100500, experiment: 1, bioproject: 1 },
} as unknown as DatasetResponse

const schema = datasetSchema(DATASET, "https://viewer.example.org")

describe("datasetSchema", () => {
  it("describes a schema.org Dataset at the top page of the host that serves it", () => {
    expect(schema["@context"]).toBe("https://schema.org")
    expect(schema["@type"]).toBe("Dataset")
    expect(schema.url).toBe("https://viewer.example.org/")
  })

  it("takes the version, its date, and the model from the dataset", () => {
    expect(schema.version).toBe("full")
    expect(schema.dateModified).toBe("2026-10-03T21:29:30Z")
    expect(schema.measurementTechnique).toContain("mistral-small3.1:24b")
    expect(schema.description).toContain("4,100,500 public BioSamples with RNA-Seq or ChIP-Seq experiments")
    expect(schema.variableMeasured).toEqual(["Cell line", "ChIP antigen"])
  })

  it("gives the creator and the license of the RO-Crate that it is based on, and says that the license is that of the annotations", () => {
    expect(schema.isBasedOn).toBe(ANNOTATION_CRATE.url)
    expect(schema.license).toBe(ANNOTATION_CRATE.license.url)
    expect(schema.creator).toEqual({ "@type": "Organization", ...ANNOTATION_CRATE.creator })
    expect(schema.description).toContain(`The annotations are published in the RO-Crate ${ANNOTATION_CRATE.name} under ${ANNOTATION_CRATE.license.name}.`)
    expect(schema.description).toContain("come from the INSDC databases at NCBI and DDBJ")
  })

  it("has a description of the length that dataset search engines take", () => {
    expect(schema.description.length).toBeGreaterThanOrEqual(50)
    expect(schema.description.length).toBeLessThanOrEqual(5000)
  })

  it("offers the exports of every BioSample as its downloads", () => {
    expect(schema.distribution).toEqual([
      { "@type": "DataDownload", encodingFormat: "application/x-ndjson", contentUrl: "https://viewer.example.org/api/export/entries/biosample?format=ndjson" },
      { "@type": "DataDownload", encodingFormat: "text/tab-separated-values", contentUrl: "https://viewer.example.org/api/export/entries/biosample?format=tsv" },
    ])
  })
})
