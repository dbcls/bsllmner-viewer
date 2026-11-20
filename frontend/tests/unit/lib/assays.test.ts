import { readFileSync } from "node:fs"
import { resolve } from "node:path"

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
  const FIVE = [...TARGETS, "Bisulfite-Seq", "DNase-Hypersensitivity"]

  it("gives each target assay the color of its place among the target assays", () => {
    expect(TARGETS.map((assay) => assayDotClass(assay, TARGETS))).toEqual(["bg-assay-1", "bg-assay-2", "bg-assay-3"])
    expect(FIVE.map((assay) => assayDotClass(assay, FIVE))).toEqual(["bg-assay-1", "bg-assay-2", "bg-assay-3", "bg-assay-4", "bg-assay-5"])
  })

  it("gives gray to an assay after the last color and to an assay that is not a target", () => {
    expect(assayDotClass("OTHER", [...FIVE, "OTHER"])).toBe("bg-ink-mid")
    expect(assayDotClass("WGS", [...FIVE, "OTHER", "WGS"])).toBe("bg-ink-mid")
    expect(assayDotClass("Bisulfite-Seq", TARGETS)).toBe("bg-ink-mid")
  })

  it("uses every assay color of the stylesheet, and no color that the stylesheet does not have", () => {
    const css = readFileSync(resolve(process.cwd(), "app/styles/tailwind.css"), "utf8")
    const tokens = [...css.matchAll(/--color-(assay-\d+):\s*#[0-9A-Fa-f]{6}\s*;/g)].map(([, name = ""]) => `bg-${name}`)
    const many = Array.from({ length: tokens.length + 3 }, (_, index) => `assay ${index}`)
    const colored = many.map((assay) => assayDotClass(assay, many)).filter((dot) => dot.startsWith("bg-assay-"))
    expect(tokens.length).toBeGreaterThan(0)
    expect(colored).toEqual(tokens)
  })
})
