import { QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import type { Clause, DatasetResponse } from "~/lib/api/types"

import { newQueryClient } from "../query"

type FieldKind = DatasetResponse["dslFields"][number]["kind"]
type Field = { name: string; kind: FieldKind }

/** The DSL fields of a dataset with two annotation fields: the fixed fields and two per annotation field. */
const DSL_FIELDS: Field[] = [
  { name: "disease", kind: "term" },
  { name: "disease_status", kind: "status" },
  { name: "cell_type", kind: "term" },
  { name: "cell_type_status", kind: "status" },
  { name: "library_strategy", kind: "assay" },
  { name: "organism_id", kind: "organism" },
  { name: "date_published", kind: "date" },
  { name: "bioproject", kind: "bioproject" },
]

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const state = vi.hoisted(() => ({
  selects: [] as { clauses: Clause[] }[],
  keywords: [] as string[],
  dslFields: [] as Field[],
}))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const annotationFields = ["disease", "cell_type"]
  const GET = async (path: string, init?: { params?: { query?: { q?: string; field?: string } } }) => {
    if (path === "/api/dataset") {
      const field = (name: string) => ({ name, multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 1 })
      return ok({
        datasetVersion: VERSION,
        version: {},
        targetAssays: ["RNA-Seq"],
        assays: [{ name: "RNA-Seq", biosampleCount: 50 }],
        fields: annotationFields.map(field),
        dslFields: state.dslFields.map((f) => ({ ...f, operators: ["eq"] })),
        statuses: {},
        totals: { biosample: 100, experiment: 100, bioproject: 100 },
        organisms: [{ identifier: "9606", name: "Homo sapiens", biosampleCount: 50 }],
        ontologies: [],
      })
    }
    if (path === "/api/dsl/parse") return ok({ q: init?.params?.query?.q, ast: null, labels: {}, selected: [], keyword: "" })
    if (path === "/api/terms") {
      const terms = annotationFields.map((name) => ({
        field: name,
        termId: `${name}:T1`,
        label: `Hit of ${name}`,
        ontology: "mondo",
        path: [],
        descendantCount: 0,
        count: 3,
        matchedSynonym: null,
        clauses: [{ field: name, value: `${name}:T1` }],
      }))
      return ok({ datasetVersion: VERSION, field: null, query: "", populationQ: null, unit: "biosample", terms })
    }
    if (path === "/api/projects") {
      const project = { identifier: "PRJ1", title: "A project", biosampleCount: 3, experimentCount: 3, assays: [], clauses: [{ field: "bioproject", value: "PRJ1" }] }
      return ok({ datasetVersion: VERSION, q: null, populationQ: null, facetSelfExclude: true, sort: "biosampleCount:desc", pagination: { page: 1, perPage: 20, total: 1 }, items: [project] })
    }
    // The other requests never answer. The test reads only what the controls send.
    return new Promise(() => undefined)
  }
  const POST = async (path: string, init: { body: { clauses?: Clause[]; keyword?: string } }) => {
    if (path === "/api/dsl/keyword") state.keywords.push(init.body.keyword ?? "")
    else state.selects.push({ clauses: init.body.clauses ?? [] })
    return ok({ dsl: null, ast: null, labels: {}, selected: [], keyword: "" })
  }
  return { ...original, api: { ...original.api, GET, POST } }
})

import { WorkspacePage } from "~/features/workspace/workspace-page"

const open = (search = "") =>
  render(
    <QueryClientProvider client={newQueryClient()}>
      <MemoryRouter initialEntries={[`/entries${search}`]}>
        <WorkspacePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

/** The clause fields that a use of the control for each kind of DSL field sends to select. */
const USE: Record<FieldKind, (field: Field) => Promise<void>> = {
  term: async (field) => {
    await userEvent.click(await screen.findByRole("button", { name: "Add term" }))
    await userEvent.click(await screen.findByText(`Hit of ${field.name}`))
  },
  status: async (field) => {
    const base = field.name.replace(/_status$/, "")
    await userEvent.click(await screen.findByRole("combobox", { name: "Status field" }))
    await userEvent.click(await screen.findByRole("option", { name: new RegExp(base.replace("_", "[ _]"), "i") }))
    await userEvent.click(screen.getByRole("button", { name: "Mapped" }))
  },
  assay: async () => {
    await userEvent.click(await screen.findByRole("checkbox", { name: /RNA-Seq/ }))
  },
  organism: async () => {
    await userEvent.click(await screen.findByRole("checkbox", { name: /Homo sapiens/ }))
  },
  date: async () => {
    await userEvent.click(await screen.findByRole("button", { name: "1 year" }))
  },
  bioproject: async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Add PRJ1 to the condition" }))
  },
}

beforeEach(() => {
  state.selects = []
  state.keywords = []
  state.dslFields = DSL_FIELDS
})

describe("fields of the condition", () => {
  it("lists a kind of field for each way to set a field", () => {
    expect(new Set(DSL_FIELDS.map((field) => field.kind))).toEqual(new Set(Object.keys(USE)))
  })

  it.each(DSL_FIELDS.map((field) => [field.name, field] as const))("offers a way to set %s that makes a clause of the field through useCondition", async (_name, field) => {
    open(field.kind === "bioproject" ? "?tab=projects" : "")
    await USE[field.kind](field)
    await waitFor(() => expect(state.selects.length).toBeGreaterThan(0))
    expect(state.selects.at(-1)?.clauses.map((clause) => clause.field)).toEqual([field.name])
  })

  it("offers a way to set the keywords through useCondition", async () => {
    open()
    const box = await screen.findByRole("textbox", { name: "Keyword" })
    fireEvent.change(box, { target: { value: "liver" } })
    fireEvent.keyDown(box, { key: "Enter" })
    await waitFor(() => expect(state.keywords).toEqual(["liver"]))
  })
})
