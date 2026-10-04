import { describe, expect, it } from "vitest"

import { chipAtlasHref, ddbjSearchHref, ncbiHref, taxonomyHref } from "~/lib/external-links"

describe("ddbjSearchHref", () => {
  it.each([
    ["biosample", "SAMN00000001", "https://ddbj.nig.ac.jp/search/entry/biosample/SAMN00000001"],
    ["biosample", "SAMD00012345", "https://ddbj.nig.ac.jp/search/entry/biosample/SAMD00012345"],
    ["bioproject", "PRJNA123456", "https://ddbj.nig.ac.jp/search/entry/bioproject/PRJNA123456"],
    ["bioproject", "PRJDB1", "https://ddbj.nig.ac.jp/search/entry/bioproject/PRJDB1"],
    ["sra-experiment", "SRX000001", "https://ddbj.nig.ac.jp/search/entry/sra-experiment/SRX000001"],
    ["sra-experiment", "DRX123456", "https://ddbj.nig.ac.jp/search/entry/sra-experiment/DRX123456"],
  ] as const)("builds the page of a %s record %s", (type, accession, expected) => {
    expect(ddbjSearchHref(type, accession)).toBe(expected)
  })
})

describe("ncbiHref", () => {
  it.each([
    ["biosample", "SAMN00000001", "https://www.ncbi.nlm.nih.gov/biosample/SAMN00000001"],
    ["biosample", "SAMD00012345", "https://www.ncbi.nlm.nih.gov/biosample/SAMD00012345"],
    ["bioproject", "PRJNA123456", "https://www.ncbi.nlm.nih.gov/bioproject/PRJNA123456"],
    ["bioproject", "PRJDB1", "https://www.ncbi.nlm.nih.gov/bioproject/PRJDB1"],
    ["sra-experiment", "SRX000001", "https://www.ncbi.nlm.nih.gov/sra/SRX000001"],
    ["sra-experiment", "DRX123456", "https://www.ncbi.nlm.nih.gov/sra/DRX123456"],
  ] as const)("builds the page of a %s record %s", (type, accession, expected) => {
    expect(ncbiHref(type, accession)).toBe(expected)
  })
})

describe("chipAtlasHref", () => {
  it.each([
    ["SRX000001", "https://chip-atlas.org/view?id=SRX000001"],
    ["DRX123456", "https://chip-atlas.org/view?id=DRX123456"],
  ])("builds the page of the SRA Experiment %s", (accession, expected) => {
    expect(chipAtlasHref(accession)).toBe(expected)
  })
})

describe("taxonomyHref", () => {
  it.each([
    ["9606", "https://www.ncbi.nlm.nih.gov/datasets/taxonomy/9606/"],
    ["10090", "https://www.ncbi.nlm.nih.gov/datasets/taxonomy/10090/"],
  ])("builds the page of the taxonomy ID %s", (identifier, expected) => {
    expect(taxonomyHref(identifier)).toBe(expected)
  })
})
