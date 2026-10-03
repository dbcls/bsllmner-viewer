import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { wrapper } from "../query"

const ORGANISM_COUNT = 21

const state = vi.hoisted(() => ({ distributions: [] as Record<string, string | number | boolean>[] }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init: { params: { query: Record<string, string | number | boolean> } }) => {
    if (path === "/api/dataset") {
      const organisms = Array.from({ length: 21 }, (_, i) => ({ identifier: String(1000 + i), name: `Organism ${i}`, biosampleCount: 100 - i }))
      return ok({
        datasetVersion: { name: "test" },
        fields: [{ name: "disease", mappedBiosampleCount: 3 }],
        targetAssays: ["RNA-Seq"],
        assays: [{ name: "RNA-Seq", biosampleCount: 5 }],
        organisms,
        ontologies: [],
        totals: { biosample: 2000, experiment: 0, bioproject: 0 },
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
import type { Condition } from "~/features/workspace/use-condition"

const condition = { ast: null, labels: {}, selected: [], keywordText: "", isSelected: () => false } as unknown as Condition

describe("ConditionPanel", () => {
  it("asks the organism counts for every listed organism by name, even when there are more than 20", async () => {
    render(<ConditionPanel q={null} condition={condition} onAddTerm={() => undefined} />, { wrapper })
    await waitFor(() => expect(state.distributions.some((query) => query["field"] === "organism_id")).toBe(true))

    const request = state.distributions.find((query) => query["field"] === "organism_id")
    expect(String(request?.["elements"]).split(",")).toHaveLength(ORGANISM_COUNT)
    expect(request).not.toHaveProperty("limit")
    expect(screen.getByText("Organism 20")).toBeTruthy()
  })

  it("takes the share of an organism from the BioSamples of the dataset", async () => {
    render(<ConditionPanel q={null} condition={condition} onAddTerm={() => undefined} />, { wrapper })
    await waitFor(() => expect(screen.getByText("Organism 0")).toBeTruthy())

    // 21 organisms of 80 to 100 BioSamples against 2000 BioSamples: 1% is 20, so all are listed.
    expect(screen.queryAllByText(/^Organism \d+$/)).toHaveLength(ORGANISM_COUNT)
  })
})
