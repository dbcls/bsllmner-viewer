import { describe, expect, it } from "vitest"

import { entryDescription } from "~/features/sample/entry-description"
import type { EntryResponse } from "~/lib/api/types"

type Annotation = EntryResponse["annotations"][number]

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }

const annotation = (field: string, label: string | null): Annotation => ({
  field,
  value: label ?? "value",
  status: label === null ? "unmapped_no_candidate" : "mapped_exact",
  termId: label === null ? null : `T:${label}`,
  label,
  clauses: [],
  evidence: [],
})

const entry = (annotations: Annotation[], organism: string | null = "Homo sapiens"): EntryResponse => ({
  datasetVersion: VERSION,
  identifier: "SAMD1",
  type: "biosample",
  title: "a sample",
  organism: organism === null ? null : { identifier: "9606", name: organism },
  datePublished: null,
  run: "run",
  metadata: [],
  annotations,
  experiments: [],
  bioprojects: [],
})

describe("entryDescription", () => {
  it("names the BioSample with its organism, and then the labels of each field in the order of the api", () => {
    const description = entryDescription(entry([annotation("tissue", "liver"), annotation("cell_line", "HepG2")]))
    expect(description).toBe("Ontology terms of BioSample SAMD1 (Homo sapiens). Tissue: liver. Cell line: HepG2.")
  })

  it("puts the labels of a field with several values in one sentence, each label once", () => {
    const annotations = [annotation("genetic_knockout", "TP53"), annotation("genetic_knockout", "BRCA1"), annotation("genetic_knockout", "TP53")]
    expect(entryDescription(entry(annotations))).toBe("Ontology terms of BioSample SAMD1 (Homo sapiens). Genetic knockout: TP53, BRCA1.")
  })

  it("leaves out the values without a term", () => {
    const description = entryDescription(entry([annotation("drug", null), annotation("tissue", "liver")]))
    expect(description).toBe("Ontology terms of BioSample SAMD1 (Homo sapiens). Tissue: liver.")
  })

  it("names the BioSample alone when it has no organism", () => {
    expect(entryDescription(entry([annotation("tissue", "liver")], null))).toBe("Ontology terms of BioSample SAMD1. Tissue: liver.")
  })

  it("describes the page without a list of terms when no annotation has a term", () => {
    expect(entryDescription(entry([annotation("drug", null)]))).toBe(
      "The original metadata of BioSample SAMD1 (Homo sapiens) and the values that bsllmner-mk2 extracted from it.",
    )
    expect(entryDescription(entry([]))).toBe("The original metadata of BioSample SAMD1 (Homo sapiens) and the values that bsllmner-mk2 extracted from it.")
  })
})
