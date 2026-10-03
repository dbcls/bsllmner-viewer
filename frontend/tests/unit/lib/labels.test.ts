import { describe, expect, it } from "vitest"

import { assayList, fieldLabel, statusInfo, statusLabel } from "~/lib/labels"

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
