import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { fc, test } from "@fast-check/vitest"
import { describe, expect, it, vi } from "vitest"

import { axisTermsText, elementValidator, MAX_AXIS_TERMS, MAX_ENTRY_LENGTH, pastedLines, replaceTerms, resolvePasted, switchDimension, toggleTerm } from "~/features/workspace/axis/axis-terms"
import { ApiError } from "~/lib/api/client"

/** A term ID as the ontologies write them: a prefix, a colon, and a local ID. */
const termId = fc.tuple(fc.stringMatching(/^[A-Za-z]{2,10}$/), fc.stringMatching(/^[A-Za-z0-9_]{1,10}$/)).map(([prefix, local]) => `${prefix}:${local}`)

/** The value of an element of another dimension: an assay, an NCBI Taxonomy ID, or a year. */
const otherValue = fc.oneof(fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,11}$/), fc.integer({ min: 1, max: 3_000_000 }).map(String))

/** A list that repeats entries drawn from a small pool of them. */
const repeating = <T>(item: fc.Arbitrary<T>, maxLength: number) =>
  fc.uniqueArray(item, { minLength: 1, maxLength: 6 }).chain((pool) => fc.array(fc.constantFrom(...pool), { maxLength }))

const never = () => Promise.reject(new Error("a value of the axis was looked up as a label"))

describe("axisTermsText", () => {
  test.prop([fc.uniqueArray(termId, { maxLength: 40 })])(
    "returns the same terms in the same order, without a lookup, when it is replaced as it is on an annotation field",
    async (values) => {
      const findTerm = vi.fn(never)
      expect((await resolvePasted(pastedLines(axisTermsText(values)), true, findTerm)).terms).toEqual(values)
      expect(findTerm).not.toHaveBeenCalled()
    },
  )

  test.prop([fc.uniqueArray(otherValue, { maxLength: 40 })])(
    "returns the same elements in the same order when it is replaced as it is on another dimension",
    async (values) => {
      const findTerm = vi.fn(never)
      expect((await resolvePasted(pastedLines(axisTermsText(values)), false, findTerm)).terms).toEqual(values)
      expect(findTerm).not.toHaveBeenCalled()
    },
  )
})

describe("resolvePasted", () => {
  test.prop([repeating(fc.oneof(termId, fc.stringMatching(/^[a-z]{1,6}$/)), 20)])(
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

  it("uses the other entries when the api rejects a label, and counts the rejected ones", async () => {
    const rejected = new ApiError({ type: "about:blank", title: "Unprocessable Entity", status: 422 })
    const findTerm = (label: string) => (label === "too long" ? Promise.reject(rejected) : Promise.resolve(`TERM:${label}`))
    expect(await resolvePasted(["a", "too long", "b:1", "c"], true, findTerm)).toEqual({ terms: ["TERM:a", "b:1", "TERM:c"], missed: 0, rejected: 1 })
  })

  it("rejects a term ID longer than the api takes without sending it", async () => {
    const long = `T:${"x".repeat(MAX_ENTRY_LENGTH)}`
    const result = await resolvePasted([long, "A:1"], true, never)
    expect(result).toEqual({ terms: ["A:1"], missed: 0, rejected: 1 })
    expect((await resolvePasted([long], false, never)).rejected).toBe(1)
  })

  it.each([[MAX_ENTRY_LENGTH, 0], [MAX_ENTRY_LENGTH + 1, 1]])("rejects an entry of %i characters %i times, without sending it", async (length, rejected) => {
    expect((await resolvePasted([`T:${"x".repeat(length - 2)}`], true, never)).rejected).toBe(rejected)
    expect((await resolvePasted(["y".repeat(length)], false, never)).rejected).toBe(rejected)
  })

  it("does not swallow a failure of the server or the network", async () => {
    await expect(resolvePasted(["a"], true, () => Promise.reject(new ApiError({ type: "about:blank", title: "x", status: 500 })))).rejects.toThrow()
    await expect(resolvePasted(["a"], true, () => Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow("Failed to fetch")
  })

  it("fails the whole lookup when the api is busy (429), and does not count the label as rejected", async () => {
    const busy = new ApiError({ type: "about:blank", title: "Too Many Requests", status: 429 })
    const findTerm = (label: string) => (label === "b" ? Promise.reject(busy) : Promise.resolve(`TERM:${label}`))
    await expect(resolvePasted(["a", "b", "c"], true, findTerm)).rejects.toBe(busy)
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
    "counts each entry that names nothing as missed, and no other entry",
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
      // Each step is a dimension that the axis moves to, with the terms that the user selects on that dimension afterwards.
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
  const limit = fc.option(fc.integer({ min: 1, max: 25 }).map((max) => ({ max, subject: "An axis" })), { nil: undefined })

  test.prop([fc.uniqueArray(termId, { minLength: 1, maxLength: 30 }), fc.nat(), limit])(
    "removes a term that the axis has and keeps the order of the other terms, also at or over the limit",
    (values, n, max) => {
      const value = values[n % values.length] ?? ""
      expect(toggleTerm(values, value, max)).toEqual({ terms: values.filter((v) => v !== value), alert: null })
    },
  )

  test.prop([fc.uniqueArray(termId, { maxLength: 20 }), termId, fc.integer({ min: 1, max: 25 })])(
    "adds a term that the axis does not have to the end only while the axis is under its limit",
    (values, term, max) => {
      const value = values.includes(term) ? `${term}-new` : term
      const result = toggleTerm(values, value, { max, subject: "An axis" })
      if (values.length >= max) {
        expect(result.terms).toEqual(values)
        expect(result.alert).toBe(`An axis shows up to ${max} ${max === 1 ? "term" : "terms"}.`)
      } else {
        expect(result).toEqual({ terms: [...values, value], alert: null })
      }
    },
  )

  test.prop([fc.uniqueArray(termId, { maxLength: 20 }), termId])("adds a term that the axis does not have when there is no limit", (values, term) => {
    const value = values.includes(term) ? `${term}-new` : term
    expect(toggleTerm(values, value)).toEqual({ terms: [...values, value], alert: null })
  })
})

describe("MAX_AXIS_TERMS", () => {
  it("is the most elements of one dimension that the api takes", () => {
    const types = readFileSync(resolve(process.cwd(), "app/lib/api/openapi-types.ts"), "utf8")
    const limits = [...types.matchAll(/Comma-separated elements, at most (\d+)/g)].map((match) => Number(match[1]))
    expect(limits.length).toBeGreaterThan(0)
    expect(new Set(limits)).toEqual(new Set([MAX_AXIS_TERMS]))
  })
})

describe("replaceTerms", () => {
  test.prop([repeating(termId, 40), fc.integer({ min: 1, max: 15 })])(
    "gives the resolved terms in the pasted order, without repeats, and no more than the limit, and counts a repeated term as recognized",
    async (entries, max) => {
      const result = await replaceTerms(entries, (list) => resolvePasted(list, true, never), { max, subject: "An axis" })
      const unique = [...new Set(entries)]
      if (unique.length === 0) {
        expect(result.terms).toBeNull()
        expect(result.alert).toBe("No terms recognized.")
        return
      }
      expect(result.terms).toEqual(unique.slice(0, max))
      expect(result.terms?.length).toBeLessThanOrEqual(max)
      expect(result.alert).toBe(unique.length > max ? `The first ${max} of ${unique.length} terms are shown.` : `${entries.length} of ${entries.length} terms recognized.`)
    },
  )

  it("does not count the labels that name nothing as recognized", async () => {
    const result = await replaceTerms(["A:1", "nothing", "also nothing"], (list) => resolvePasted(list, true, () => Promise.resolve(null)))
    expect(result).toEqual({ terms: ["A:1"], alert: "1 of 3 terms recognized." })
  })

  it("reports the rejected entries in the alert and uses the others", async () => {
    const rejected = new ApiError({ type: "about:blank", title: "x", status: 422 })
    const find = (label: string) => (label === "bad" ? Promise.reject(rejected) : Promise.resolve(null))
    expect(await replaceTerms(["A:1", "bad", "none"], (list) => resolvePasted(list, true, find))).toEqual({ terms: ["A:1"], alert: "1 of 3 terms recognized, 1 not valid." })
    expect(await replaceTerms(["bad"], (list) => resolvePasted(list, true, find))).toEqual({ terms: null, alert: "No terms recognized, 1 not valid." })
  })

  it("keeps every term when there is no limit", async () => {
    const entries = Array.from({ length: 600 }, (_, i) => `T:${i}`)
    expect((await replaceTerms(entries, (list) => resolvePasted(list, true, never))).terms).toEqual(entries)
  })
})

describe("elementValidator", () => {
  it.each([
    ["1", "organism_id", true],
    ["2147483647", "organism_id", true],
    ["2147483648", "organism_id", false],
    ["0", "organism_id", false],
    ["9999999999", "organism_id", false],
    ["12345678901", "organism_id", false],
    ["Homo sapiens", "organism_id", false],
    ["1000", "date_published", true],
    ["9999", "date_published", true],
    ["999", "date_published", false],
    ["0999", "date_published", false],
    ["10000", "date_published", false],
  ])("takes %s as an element of %s: %s", (value, field, accepted) => {
    expect(elementValidator(field)?.(value)).toBe(accepted)
  })

  it("takes anything for a dimension that has no format", () => {
    expect(elementValidator("library_strategy")).toBeNull()
  })

  const decorate = fc.constantFrom(
    (s: string) => `0${s}`,
    (s: string) => `+${s}`,
    (s: string) => ` ${s}`,
    (s: string) => `${s} `,
    (s: string) => `${s}.0`,
    (s: string) => `${s}e0`,
    (s: string) => `${s}a`,
    (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d))),
  )

  describe("organism_id", () => {
    const organism = elementValidator("organism_id") ?? (() => false)
    test.prop([fc.integer({ min: 1, max: 2 ** 31 - 1 })])("takes the decimal form of an organism ID from 1 to 2**31 - 1", (n) => {
      expect(organism(String(n))).toBe(true)
    })
    test.prop([fc.oneof(fc.integer({ min: -(2 ** 31), max: 0 }), fc.integer({ min: 2 ** 31, max: 99_999_999_999 }))])("does not take a number outside 1 to 2**31 - 1", (n) => {
      expect(organism(String(n))).toBe(false)
    })
    test.prop([fc.integer({ min: 1, max: 2 ** 31 - 1 }), decorate])("does not take another form of an organism ID", (n, decorated) => {
      expect(organism(decorated(String(n)))).toBe(false)
    })
  })

  describe("date_published", () => {
    const year = elementValidator("date_published") ?? (() => false)
    test.prop([fc.integer({ min: 1000, max: 9999 })])("takes a year from 1000 to 9999", (n) => {
      expect(year(String(n))).toBe(true)
    })
    test.prop([fc.oneof(fc.integer({ min: -99_999, max: 999 }), fc.integer({ min: 10_000, max: 99_999 }))])("does not take a number outside 1000 to 9999", (n) => {
      expect(year(String(n))).toBe(false)
    })
    test.prop([fc.integer({ min: 1000, max: 9999 }), decorate])("does not take another form of a year", (n, decorated) => {
      expect(year(decorated(String(n)))).toBe(false)
    })
  })

  it("counts an entry that is not a valid element as missed and does not look it up", async () => {
    const result = await resolvePasted(["9606", "Homo sapiens", "10090"], false, never, elementValidator("organism_id") ?? undefined)
    expect(result).toEqual({ terms: ["9606", "10090"], missed: 1, rejected: 0 })
  })
})
