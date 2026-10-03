import { describe, expect, it } from "vitest"

import { barsSvg } from "~/features/workspace/distribution/bars-svg"

const labelsOf = (rows: Parameters<typeof barsSvg>[2]) =>
  [...new DOMParser().parseFromString(barsSvg("Disease", "BioSamples", rows), "image/svg+xml").querySelectorAll("text")].map((t) => t.textContent)

describe("barsSvg", () => {
  it("writes the term ID after the label of a bar that has one, and only the label of the others", () => {
    const labels = labelsOf([
      { label: "breast cancer", id: "MONDO:0007254", count: 3 },
      { label: "lung cancer", count: 2 },
    ])
    expect(labels).toContain("breast cancer MONDO:0007254")
    expect(labels).toContain("lung cancer")
  })
})
