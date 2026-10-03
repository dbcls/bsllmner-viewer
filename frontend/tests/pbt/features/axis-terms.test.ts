import { fc, test } from "@fast-check/vitest"
import { describe, expect, it, vi } from "vitest"

import { axisTermsText, pastedLines, resolvePasted, switchDimension } from "~/features/workspace/heatmap/axis-terms"

/** A term ID as the ontologies write them: a prefix, a colon, and a local ID. */
const termId = fc.tuple(fc.stringMatching(/^[A-Za-z]{2,10}$/), fc.stringMatching(/^[A-Za-z0-9_]{1,10}$/)).map(([prefix, local]) => `${prefix}:${local}`)

/** The value of an element of another dimension: an assay, an NCBI Taxonomy ID, or a year. */
const otherValue = fc.oneof(fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,11}$/), fc.integer({ min: 1, max: 3_000_000 }).map(String))

const never = () => Promise.reject(new Error("a value of the axis was looked up as a label"))

describe("axisTermsText", () => {
  test.prop([fc.uniqueArray(termId, { maxLength: 40 })])(
    "gives back the same terms in the same order, without a lookup, when it is replaced as it is on an annotation field",
    async (values) => {
      const findTerm = vi.fn(never)
      expect(await resolvePasted(pastedLines(axisTermsText(values)), true, findTerm)).toEqual(values)
      expect(findTerm).not.toHaveBeenCalled()
    },
  )

  test.prop([fc.uniqueArray(otherValue, { maxLength: 40 })])(
    "gives back the same elements in the same order when it is replaced as it is on another dimension",
    async (values) => {
      const findTerm = vi.fn(never)
      expect(await resolvePasted(pastedLines(axisTermsText(values)), false, findTerm)).toEqual(values)
      expect(findTerm).not.toHaveBeenCalled()
    },
  )
})

describe("resolvePasted", () => {
  test.prop([fc.array(fc.oneof(termId, fc.stringMatching(/^[a-z]{1,6}$/)), { maxLength: 20 })])(
    "keeps the order of the entries, drops the repeats and the labels that name nothing, and looks up only the labels",
    async (entries) => {
      const labels = new Map<string, string | null>()
      const findTerm = vi.fn((label: string) => {
        if (!labels.has(label)) labels.set(label, label.length % 2 === 0 ? `TERM:${label}` : null)
        return Promise.resolve(labels.get(label) ?? null)
      })
      const expected = [...new Set(entries.map((entry) => (entry.includes(":") ? entry : labels.get(entry) ?? (entry.length % 2 === 0 ? `TERM:${entry}` : null))).filter((v): v is string => v !== null))]
      expect(await resolvePasted(entries, true, findTerm)).toEqual(expected)
      expect(findTerm.mock.calls.every(([label]) => !label.includes(":"))).toBe(true)
    },
  )

  it("reads entries separated by new lines, commas, and semicolons, and skips blank ones", () => {
    expect(pastedLines(" MCF-7 \n\nHeLa, K-562;;A-549 \n")).toEqual(["MCF-7", "HeLa", "K-562", "A-549"])
  })

  it("gives nothing for a list of blanks", async () => {
    expect(await resolvePasted(pastedLines(" \n , ; "), true, never)).toEqual([])
  })
})

const dimension = fc.constantFrom("cell_line", "tissue", "disease", "library_strategy")
const choice = fc.record({ terms: fc.option(fc.uniqueArray(termId, { maxLength: 5 }), { nil: null }) })

describe("switchDimension", () => {
  test.prop([fc.array(fc.tuple(dimension, choice), { minLength: 1, maxLength: 12 })])(
    "shows on each dimension what the axis showed when it last left it, and the top terms on a dimension it has not shown",
    (steps) => {
      // Each step is the dimension that the axis moves to, with what the user then leaves on it.
      let memory = {}
      let at = "cell_line"
      let current: { terms: string[] | null } = { terms: null }
      const left = new Map<string, typeof current>()
      for (const [to, edited] of steps) {
        if (to !== at) left.set(at, current)
        const switched = switchDimension(memory, at, to, current)
        expect(switched.next).toEqual(to === at ? current : left.get(to) ?? { terms: null })
        memory = switched.memory
        at = to
        current = edited
      }
    },
  )

  it("keeps what the axis shows when the dimension does not change", () => {
    const current = { terms: ["CVCL:0031"] }
    expect(switchDimension({ cell_line: { terms: null } }, "cell_line", "cell_line", current).next).toBe(current)
  })
})

