import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { wrapper } from "../query"

const ORGANISM_COUNT = 21

type Organism = { identifier: string; name: string; biosampleCount: number }
const state = vi.hoisted(() => ({
  distributions: [] as Record<string, string | number | boolean>[],
  organisms: [] as Organism[],
  totals: { biosample: 2000, experiment: 0, bioproject: 0 },
}))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init: { params: { query: Record<string, string | number | boolean> } }) => {
    if (path === "/api/dataset") {
      return ok({
        datasetVersion: { name: "test" },
        fields: [{ name: "disease", mappedBiosampleCount: 3 }],
        targetAssays: ["RNA-Seq"],
        assays: [{ name: "RNA-Seq", biosampleCount: 5 }],
        organisms: state.organisms,
        ontologies: [],
        totals: state.totals,
      })
    }
    if (path === "/api/distribution") {
      state.distributions.push(init.params.query)
      return ok({ elements: [], total: 0 })
    }
    return ok(null)
  }
  return { ...original, api: { GET, POST: GET } }
})

import { ConditionPanel } from "~/features/workspace/condition-panel"
import { useCondition } from "~/features/workspace/use-condition"
import { DEFAULTS } from "~/lib/workspace-state"

const Panel = () => <ConditionPanel q={null} condition={useCondition(null, vi.fn(), () => DEFAULTS)} onAddTerm={() => undefined} />

describe("ConditionPanel", () => {
  beforeEach(() => {
    state.distributions.length = 0
    state.totals = { biosample: 2000, experiment: 0, bioproject: 0 }
    state.organisms = Array.from({ length: ORGANISM_COUNT }, (_, i) => ({ identifier: String(1000 + i), name: `Organism ${i}`, biosampleCount: 100 - i }))
  })

  it("asks the organism counts for every listed organism by name, even when there are more than 20", async () => {
    render(<Panel />, { wrapper })
    await waitFor(() => expect(state.distributions.some((query) => query["field"] === "organism_id")).toBe(true))

    const request = state.distributions.find((query) => query["field"] === "organism_id")
    expect(String(request?.["elements"]).split(",")).toHaveLength(ORGANISM_COUNT)
    expect(request).not.toHaveProperty("limit")
    expect(screen.getByText("Organism 20")).toBeInTheDocument()
  })

  it("counts assays and organisms with self-exclusion", async () => {
    render(<Panel />, { wrapper })
    await waitFor(() => {
      const fields = state.distributions.map((query) => query["field"])
      expect(fields).toContain("library_strategy")
      expect(fields).toContain("organism_id")
    })
    for (const field of ["library_strategy", "organism_id"]) {
      const request = state.distributions.find((query) => query["field"] === field)
      expect(request).toHaveProperty("facetSelfExclude", true)
    }
  })

  it("lists an organism with exactly one percent of the BioSamples of the dataset, and not an organism with less", async () => {
    state.totals = { biosample: 2000, experiment: 3000, bioproject: 0 }
    state.organisms = [
      { identifier: "1", name: "At the share", biosampleCount: 20 },
      { identifier: "2", name: "Below the share", biosampleCount: 19 },
    ]
    render(<Panel />, { wrapper })
    await waitFor(() => expect(screen.getByText("At the share")).toBeInTheDocument())
    expect(screen.queryByText("Below the share")).not.toBeInTheDocument()
  })
})
