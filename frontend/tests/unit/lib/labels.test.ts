import { describe, expect, it } from "vitest"

import { assayList, fieldLabel, ontologyName, STATUS_INFO, STATUS_ORDER, statusInfo, statusLabel } from "~/lib/labels"

describe("assayList", () => {
  it("joins one, two, and three assays as a sentence", () => {
    expect(assayList(["RNA-Seq"])).toBe("RNA-Seq")
    expect(assayList(["RNA-Seq", "ChIP-Seq"])).toBe("RNA-Seq or ChIP-Seq")
    expect(assayList(["RNA-Seq", "ChIP-Seq", "ATAC-seq"])).toBe("RNA-Seq, ChIP-Seq, or ATAC-seq")
  })
})

describe("lookups by a name of Object.prototype", () => {
  it("gives text, not a function, for a field or a status named like a method", () => {
    expect(fieldLabel("constructor")).toBe("Constructor")
    expect(fieldLabel("toString")).toBe("ToString")
    expect(statusLabel("constructor")).toBe("constructor")
    expect(statusInfo("toString").label).toBe("toString")
  })
})

describe("fieldLabel", () => {
  it("names a status field after the label of its field", () => {
    expect(fieldLabel("library_strategy_status")).toBe("Assay status")
    expect(fieldLabel("cell_line_status")).toBe("Cell line status")
  })
})

describe("STATUS_ORDER", () => {
  it("lists every status of STATUS_INFO once", () => {
    expect([...STATUS_ORDER].sort()).toEqual(Object.keys(STATUS_INFO).sort())
  })
})

describe("ontologyName", () => {
  it("gives the prefix for an ontology that the dataset does not describe", () => {
    expect(ontologyName("XX", [{ prefix: "MONDO", name: "Mondo Disease Ontology" }])).toBe("XX")
  })
})
