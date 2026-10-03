import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import { FIGURE_SAVE_FAILED } from "~/lib/export"
import { DEFAULTS } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string) => {
    if (path === "/api/dataset") {
      const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 1 }
      return ok({ datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    const element = { value: "A", label: "label A", clauses: [{ field: "disease", value: "A" }], count: 3 }
    return ok({ datasetVersion: VERSION, q: null, unit: "biosample", total: 3, withoutTerm: null, elements: [element] })
  }
  return { ...original, api: { ...original.api, GET } }
})

import { DistributionTab } from "~/features/workspace/distribution/distribution-tab"
import type { Condition } from "~/features/workspace/use-condition"

const condition = { isSelected: () => false, selected: [], toggle: vi.fn(), toggleNarrow: vi.fn() } as unknown as Condition

describe("the Export of a figure", () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ["SVG", () => Promise.reject(new TypeError("offline"))],
    ["PNG", () => Promise.reject(new TypeError("offline"))],
    ["SVG", () => Promise.resolve(new Response("not found", { status: 404 }))],
    ["PNG", () => Promise.resolve(new Response("not found", { status: 404 }))],
  ])("says that the figure could not be saved when its fonts cannot be loaded (%s)", async (format, answer) => {
    vi.stubGlobal("fetch", vi.fn(answer))
    const user = userEvent.setup()
    const onAlert = vi.fn()
    renderWithQuery(<DistributionTab state={{ ...DEFAULTS, tab: "distribution" }} condition={condition} onUnit={vi.fn()} onTermIds={vi.fn()} onAlert={onAlert} />)
    const button = await screen.findByRole("button", { name: "Export the Disease distribution" })
    await vi.waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await user.click(screen.getByRole("menuitem", { name: new RegExp(`^${format}`) }))
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith(FIGURE_SAVE_FAILED))
  })
})
