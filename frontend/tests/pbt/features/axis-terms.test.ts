import { fc, test } from "@fast-check/vitest"
import { describe, expect, it, vi } from "vitest"

import { axisTermsText, MAX_AXIS_TERMS, pastedLines, replaceTerms, resolvePasted, switchDimension, toggleTerm } from "~/features/workspace/axis/axis-terms"

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
      expect((await resolvePasted(pastedLines(axisTermsText(values)), true, findTerm)).terms).toEqual(values)
      expect(findTerm).not.toHaveBeenCalled()
    },
  )

  test.prop([fc.uniqueArray(otherValue, { maxLength: 40 })])(
    "gives back the same elements in the same order when it is replaced as it is on another dimension",
    async (values) => {
      const findTerm = vi.fn(never)
      expect((await resolvePasted(pastedLines(axisTermsText(values)), false, findTerm)).terms).toEqual(values)
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
      expect((await resolvePasted(entries, true, findTerm)).terms).toEqual(expected)
      expect(findTerm.mock.calls.every(([label]) => !label.includes(":"))).toBe(true)
    },
  )

  it("reads one entry per line and skips blank ones", () => {
    expect(pastedLines(" MCF-7 \n\r\nHeLa \n\nK-562\n")).toEqual(["MCF-7", "HeLa", "K-562"])
  })

  it("keeps a comma and a semicolon inside an entry", () => {
    expect(pastedLines("CD4-positive, alpha-beta T cell\nRS4;11")).toEqual(["CD4-positive, alpha-beta T cell", "RS4;11"])
  })

  it("gives nothing for a list of blanks", async () => {
    expect((await resolvePasted(pastedLines(" \n \t\n"), true, never)).terms).toEqual([])
  })

  it("takes only an entry of a prefix, a colon, and a local ID without blanks as a term ID", async () => {
    const findTerm = vi.fn((label: string) => Promise.resolve(`FOUND:${label.length}`))
    const result = await resolvePasted(["MONDO:0007254", "type 2: diabetes", "a: b", "stage:"], true, findTerm)
    expect(findTerm.mock.calls.map(([label]) => label)).toEqual(["type 2: diabetes", "a: b", "stage:"])
    expect(result.terms[0]).toBe("MONDO:0007254")
  })

  test.prop([fc.array(fc.oneof(termId, fc.stringMatching(/^[a-z]{1,6}$/)), { maxLength: 20 })])(
    "counts the entries that are repeats as recognised and the labels that name nothing as missed",
    async (entries) => {
      const result = await resolvePasted(entries, true, (label) => Promise.resolve(label.length % 2 === 0 ? `TERM:${label}` : null))
      const named = entries.filter((entry) => entry.includes(":") || entry.length % 2 === 0)
      expect(result.missed).toBe(entries.length - named.length)
    },
  )
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

describe("toggleTerm", () => {
  test.prop([fc.uniqueArray(termId, { maxLength: 20 }), termId, fc.integer({ min: 1, max: 25 })])(
    "takes a term that the axis has off, and adds a term that it lacks to the end only while the axis is under its limit",
    (values, value, max) => {
      const result = toggleTerm(values, value, { max, subject: "An axis" })
      if (values.includes(value)) {
        expect(result).toEqual({ terms: values.filter((v) => v !== value), alert: null })
      } else if (values.length >= max) {
        expect(result.terms).toEqual(values)
        expect(result.alert).toBe(`An axis shows up to ${max} terms`)
      } else {
        expect(result).toEqual({ terms: [...values, value], alert: null })
      }
    },
  )

  test.prop([fc.uniqueArray(termId, { maxLength: 20 }), termId])("adds without a limit", (values, value) => {
    expect(toggleTerm(values, value).terms.includes(value)).toBe(!values.includes(value))
  })

  it("does not add a term to an axis of the most terms that the api takes", () => {
    const full = Array.from({ length: MAX_AXIS_TERMS }, (_, i) => `T:${i}`)
    const result = toggleTerm(full, "T:new", { max: MAX_AXIS_TERMS, subject: "A heatmap axis" })
    expect(result.terms).toEqual(full)
    expect(result.alert).toBe(`A heatmap axis shows up to ${MAX_AXIS_TERMS} terms`)
  })
})

describe("replaceTerms", () => {
  test.prop([fc.array(termId, { maxLength: 40 }), fc.integer({ min: 1, max: 15 })])(
    "gives the resolved terms in the pasted order, without repeats, and no more than the limit",
    async (entries, max) => {
      const result = await replaceTerms(entries, (list) => resolvePasted(list, true, never), { max, subject: "An axis" })
      const unique = [...new Set(entries)]
      if (unique.length === 0) {
        expect(result.terms).toBeNull()
        expect(result.alert).toBe("No terms recognised")
        return
      }
      expect(result.terms).toEqual(unique.slice(0, max))
      expect(result.terms?.length).toBeLessThanOrEqual(max)
      expect(result.alert).toBe(unique.length > max ? `The first ${max} of ${unique.length} terms are shown` : `${entries.length} of ${entries.length} terms recognised`)
    },
  )

  it("counts a repeated term as recognised", async () => {
    const result = await replaceTerms(["A:1", "A:1", "B:2"], (list) => resolvePasted(list, true, never))
    expect(result).toEqual({ terms: ["A:1", "B:2"], alert: "3 of 3 terms recognised" })
  })

  it("does not count the labels that name nothing as recognised", async () => {
    const result = await replaceTerms(["A:1", "nothing", "also nothing"], (list) => resolvePasted(list, true, () => Promise.resolve(null)))
    expect(result).toEqual({ terms: ["A:1"], alert: "1 of 3 terms recognised" })
  })

  it("keeps every term when there is no limit", async () => {
    const entries = Array.from({ length: 600 }, (_, i) => `T:${i}`)
    expect((await replaceTerms(entries, (list) => resolvePasted(list, true, never))).terms).toEqual(entries)
  })

  it("uses the first 500 of a longer list and says so", async () => {
    const entries = Array.from({ length: 501 }, (_, i) => `T:${i}`)
    const result = await replaceTerms(entries, (list) => resolvePasted(list, true, never), { max: MAX_AXIS_TERMS, subject: "A heatmap axis" })
    expect(result.terms).toEqual(entries.slice(0, MAX_AXIS_TERMS))
    expect(result.alert).toBe("The first 500 of 501 terms are shown")
  })
})
