import { describe, expect, it } from "vitest"

import { assayDotClass, orderAssays } from "~/lib/assays"

const TARGETS = ["RNA-Seq", "ChIP-Seq", "ATAC-seq"]

describe("orderAssays", () => {
  it("follows the order of the target assays, not the alphabet", () => {
    expect(orderAssays(["ATAC-seq", "ChIP-Seq", "RNA-Seq"], TARGETS)).toEqual(["RNA-Seq", "ChIP-Seq", "ATAC-seq"])
    expect(orderAssays(["ATAC-seq", "RNA-Seq"], TARGETS)).toEqual(["RNA-Seq", "ATAC-seq"])
  })

  it("follows a target assay that the dataset adds, in its place", () => {
    expect(orderAssays(["WGS", "ATAC-seq", "RNA-Seq"], ["RNA-Seq", "WGS", "ATAC-seq"])).toEqual(["RNA-Seq", "WGS", "ATAC-seq"])
  })

  it("puts an assay that is not a target after the targets, in alphabetical order", () => {
    expect(orderAssays(["WGS", "Bisulfite-Seq", "ChIP-Seq"], TARGETS)).toEqual(["ChIP-Seq", "Bisulfite-Seq", "WGS"])
  })

  it("lists an assay once and gives nothing for no assay", () => {
    expect(orderAssays(["RNA-Seq", "RNA-Seq"], TARGETS)).toEqual(["RNA-Seq"])
    expect(orderAssays([], TARGETS)).toEqual([])
  })
})

describe("assayDotClass", () => {
  it("gives each target assay the color of its place among the target assays", () => {
    expect(TARGETS.map((assay) => assayDotClass(assay, TARGETS))).toEqual(["bg-assay-1", "bg-assay-2", "bg-assay-3"])
  })

  it("gives gray to an assay after the last color and to an assay that is not a target", () => {
    expect(assayDotClass("WGS", [...TARGETS, "WGS"])).toBe("bg-ink-softer")
    expect(assayDotClass("Bisulfite-Seq", TARGETS)).toBe("bg-ink-softer")
  })
})
