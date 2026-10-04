import { fc, test } from "@fast-check/vitest"
import { QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { formatCount } from "~/lib/format"
import { TABS } from "~/lib/workspace-state"

import { newQueryClient } from "../query"

/** The counts that the responses carry. Every value is different from the others and from the sums of the others. */
type Counts = {
  entries: number
  experiments: number
  projects: number
  assay: number
  organism: number
  bar: number
  withoutTerm: number
  projectBiosamples: number
  projectExperiments: number
  cell: number
  rowTotal: number
  colTotal: number
  crosstabTotal: number
  condition: number
  all: number
  hit: number
}
const KEYS = ["entries", "experiments", "projects", "assay", "organism", "bar", "withoutTerm", "projectBiosamples", "projectExperiments", "cell", "rowTotal", "colTotal", "crosstabTotal", "condition", "all", "hit"] as const satisfies readonly (keyof Counts)[]

const net = vi.hoisted(() => ({ counts: {} as Counts }))
const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: { q?: string; field?: string } } }) => {
    const n = net.counts
    const clause = { field: "disease", value: "D:1" }
    switch (path) {
      case "/api/dataset": {
        const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 1 }
        return ok({
          datasetVersion: VERSION,
          version: {},
          targetAssays: ["RNA-Seq"],
          assays: [{ name: "RNA-Seq", biosampleCount: 1 }],
          fields: [field],
          dslFields: [],
          statuses: {},
          totals: { biosample: 1000, experiment: 1000, bioproject: 1000 },
          organisms: [{ identifier: "9606", name: "Homo sapiens", biosampleCount: 500 }],
          ontologies: [],
        })
      }
      case "/api/dsl/parse":
        return ok({ q: init?.params?.query?.q, ast: null, labels: {}, selected: [], keyword: "" })
      case "/api/entries/{type}": {
        const item = { identifier: "SAMD1", title: "a sample", organism: null, libraryStrategy: [], bioprojects: [], datePublished: null, annotations: {} }
        return ok({ items: [item], pagination: { page: 1, perPage: 20, total: n.entries } })
      }
      case "/api/projects": {
        const item = { identifier: "PRJ1", title: "a project", biosampleCount: n.projectBiosamples, experimentCount: n.projectExperiments, assays: [], clauses: [] }
        return ok({ datasetVersion: VERSION, q: null, populationQ: null, facetSelfExclude: true, sort: "biosampleCount:desc", pagination: { page: 1, perPage: 20, total: n.projects }, items: [item] })
      }
      case "/api/distribution": {
        const field = init?.params?.query?.field
        const value = field === "library_strategy" ? "RNA-Seq" : field === "organism_id" ? "9606" : "D:1"
        const count = field === "library_strategy" ? n.assay : field === "organism_id" ? n.organism : n.bar
        const element = { value, label: `label ${value}`, clauses: [{ field: field ?? "disease", value }], count }
        return ok({ datasetVersion: VERSION, q: null, unit: "biosample", total: n.experiments, withoutTerm: n.withoutTerm, elements: [element] })
      }
      case "/api/crosstab": {
        const element = (value: string, count: number) => ({ value, label: `label ${value}`, clauses: [clause], count })
        const cell = { row: "R", col: "C", count: n.cell, expected: null, ratio: null, residual: null, classification: null }
        return ok({ datasetVersion: VERSION, q: null, populationQ: null, total: n.crosstabTotal, rows: [{ ...element("R", n.rowTotal), hasChildren: false, parents: [] }], cols: [element("C", n.colTotal)], cells: [cell] })
      }
      case "/api/trend": {
        const points = (count: number) => [{ year: 2020, count, clauses: [] }]
        return ok({ datasetVersion: VERSION, q: null, populationQ: null, unit: "biosample", years: [2020], firstYear: 2020, lastYear: 2020, total: points(n.condition), allEntries: points(n.all), series: [] })
      }
      case "/api/terms": {
        const hit = { field: "disease", termId: "D:1", label: "hit of disease", ontology: "mondo", path: [], descendantCount: 0, count: n.hit, matchedSynonym: null, clauses: [clause] }
        return ok({ datasetVersion: VERSION, field: null, query: "", populationQ: null, unit: "biosample", terms: [hit] })
      }
      default:
        throw new Error(`unexpected request ${path}`)
    }
  }
  return { ...original, api: { ...original.api, GET } }
})

import { WorkspacePage } from "~/features/workspace/workspace-page"

afterEach(() => cleanup())

const counts: fc.Arbitrary<Counts> = fc
  .uniqueArray(fc.integer({ min: 1_000_000, max: 9_999_999 }), { minLength: KEYS.length, maxLength: KEYS.length })
  // A value that equals the sum or the difference of two others would not tell a displayed value from a sum or a difference.
  // A difference of at least 10,000 cannot equal a small number of the page, such as a page number or a year.
  .filter((values) =>
    values.every((a) => values.every((b, j) => values.every((c, k) => j >= k || (a !== b + c && a !== Math.abs(b - c) && Math.abs(b - c) >= 10_000)))),
  )
  .map((values) => Object.fromEntries(KEYS.map((key, index) => [key, values[index]])) as Counts)

/** The text of the nodes of the element, with a space between the nodes, so that the numbers of neighboring cells stay apart. */
const textOf = (element: Element): string => {
  const parts: string[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? "")
  return parts.join(" ")
}

/** Whether the text has the number as a whole number, not as a part of a longer one. */
const shows = (text: string, count: number): boolean => new RegExp(`(^|[^\\d,])${formatCount(count)}($|[^\\d,])`).test(text)

/** Every run of a property renders again, so the page of the previous run is removed first. */
const open = (tab: string) => {
  cleanup()
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <MemoryRouter initialEntries={[`/entries?q=disease%3AD%3A1&tab=${tab}&row=disease&col=library_strategy&trend_all=on&trend_labels=on`]}>
        <WorkspacePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The counts that each tab shows besides those of the condition bar and the condition panel. */
const OF_TAB: Record<(typeof TABS)[number], (keyof Counts)[]> = {
  samples: [],
  projects: ["projectBiosamples", "projectExperiments"],
  distribution: ["bar", "withoutTerm"],
  heatmap: ["cell", "rowTotal", "colTotal", "crosstabTotal"],
  trend: ["condition", "all"],
}
const EVERYWHERE: (keyof Counts)[] = ["entries", "experiments", "projects", "assay", "organism"]

describe.each(TABS)("counts of the %s tab", (tab) => {
  test.prop([counts], { numRuns: 5, endOnFailure: true })(
    "are the numbers of the responses, and not a sum or a difference of them",
    async (given) => {
      net.counts = given
      open(tab)
      const shown = [...EVERYWHERE, ...OF_TAB[tab]]
      await waitFor(() => {
        const text = textOf(document.body)
        for (const key of shown) expect(shows(text, given[key]), `${tab}: ${key}`).toBe(true)
      })
      const text = textOf(document.body)
      for (const a of KEYS) {
        for (const b of KEYS) {
          if (a >= b) continue
          expect(shows(text, given[a] + given[b]), `${a} + ${b}`).toBe(false)
          expect(shows(text, Math.abs(given[a] - given[b])), `${a} - ${b}`).toBe(false)
        }
      }
    },
    30_000,
  )
})

describe("counts of the term picker", () => {
  test.prop([counts], { numRuns: 5, endOnFailure: true })("are the counts of the response", async (given) => {
    net.counts = given
    open("samples")
    await userEvent.click(await screen.findByRole("button", { name: "Add term" }))
    await screen.findByText("hit of disease")
    await waitFor(() => expect(shows(textOf(screen.getByRole("dialog")), given.hit)).toBe(true))
  })
})
