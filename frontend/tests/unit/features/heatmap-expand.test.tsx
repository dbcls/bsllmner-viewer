import { act, fireEvent, screen } from "@testing-library/react"
import { useRef, useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Update } from "~/features/workspace/state"
import type * as Client from "~/lib/api/client"
import { DEFAULTS, type Patch, type WorkspaceState } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

const net = vi.hoisted(() => ({ children: new Map<string, () => void>(), childrenOf: {} as Record<string, string[]>, childRequests: [] as string[], failChildren: false }))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const label = (value: string) => `label ${value}`

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok, failure } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: Record<string, unknown> } }) => {
    const query = init?.params?.query ?? {}
    if (path === "/api/dataset") {
      const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 0 }
      return ok({ datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] })
    }
    const element = (value: string) => ({ value, label: label(value), clauses: [{ field: "disease", value }], count: 1 })
    if (path === "/api/crosstab") {
      const rows = String(query["rowElements"]).split(",").map((value) => ({ ...element(value), countExact: 0, countSelected: 0, hasChildren: true, parents: [] }))
      return ok({ datasetVersion: VERSION, q: null, populationQ: null, rowField: "disease", colField: "library_strategy", unit: "biosample", facetSelfExclude: true, total: 1, rows, cols: [element("RNA-Seq")], cells: [] })
    }
    if (path === "/api/terms/children") {
      const termId = String(query["termId"])
      net.childRequests.push(termId)
      if (net.failChildren) return failure(500)
      await new Promise<void>((resolve) => net.children.set(termId, resolve))
      return ok({ field: "disease", termId, children: (net.childrenOf[termId] ?? []).map(element) })
    }
    throw new Error(`unexpected request ${path}`)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { HeatmapTab } from "~/features/workspace/heatmap/heatmap-tab"
import type { Condition } from "~/features/workspace/use-condition"

const condition = { isSelected: () => false, toggle: vi.fn(), toggleNarrow: vi.fn() } as unknown as Condition

const Harness = ({ initial, onUpdate, onAlert }: { initial: WorkspaceState; onUpdate: (patch: Patch) => void; onAlert: (message: string) => void }) => {
  const [state, setState] = useState(initial)
  const latest = useRef(initial)
  const update: Update = (patch) => {
    onUpdate(patch)
    latest.current = { ...latest.current, ...patch }
    setState(latest.current)
  }
  return (
    <>
      <button onClick={() => update({ row: "cell_type" })}>Switch row</button>
      <HeatmapTab state={state} condition={condition} update={update} latest={() => latest.current} replacing={false} setReplacing={vi.fn()} onAlert={onAlert} />
    </>
  )
}

const render = (rowTerms: string[]) => {
  const onUpdate = vi.fn<(patch: Patch) => void>()
  const onAlert = vi.fn<(message: string) => void>()
  renderWithQuery(<Harness initial={{ ...DEFAULTS, tab: "heatmap", row: "disease", col: "library_strategy", rowTerms }} onUpdate={onUpdate} onAlert={onAlert} />)
  return { onUpdate, onAlert }
}

const chevron = (value: string) => screen.findByRole("button", { name: new RegExp(`label ${value}$`) })
const answer = (termId: string) => act(async () => net.children.get(termId)?.())

beforeEach(() => {
  net.children.clear()
  net.childRequests.length = 0
  net.childrenOf = {}
  net.failChildren = false
})

describe("opening the children of a row", () => {
  it("keeps the children of the first row when the children of a second row arrive after them", async () => {
    net.childrenOf = { A: ["A1"], B: ["B1"] }
    const { onUpdate } = render(["A", "B"])
    fireEvent.click(await chevron("A"))
    fireEvent.click(await chevron("B"))
    await vi.waitFor(() => expect(net.children.size).toBe(2))
    await answer("A")
    await answer("B")
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: ["A", "A1", "B", "B1"] })
  })

  it("ignores a second press on a row whose children are on their way", async () => {
    net.childrenOf = { A: ["A1"] }
    const { onUpdate } = render(["A", "B"])
    const button = await chevron("A")
    fireEvent.click(button)
    fireEvent.click(button)
    expect(net.childRequests).toEqual(["A"])
    await answer("A")
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it("drops the children when the rows moved to another dimension while they waited", async () => {
    net.childrenOf = { A: ["A1"] }
    const { onUpdate } = render(["A", "B"])
    fireEvent.click(await chevron("A"))
    await vi.waitFor(() => expect(net.children.size).toBe(1))
    fireEvent.click(screen.getByRole("button", { name: "Switch row" }))
    await answer("A")
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenLastCalledWith({ row: "cell_type" })
  })

  it("does not open past the most terms that the api takes, and says so", async () => {
    net.childrenOf = { F0: ["C:new"] }
    const rows = Array.from({ length: 100 }, (_, index) => `F${index}`)
    const { onUpdate, onAlert } = render(rows)
    fireEvent.click(await chevron("F0"))
    await vi.waitFor(() => expect(net.children.size).toBe(1))
    await answer("F0")
    expect(onAlert).toHaveBeenCalledWith("A heatmap axis shows up to 100 terms")
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("says so and leaves the rows as they are when the children cannot be loaded", async () => {
    net.failChildren = true
    const { onUpdate, onAlert } = render(["A", "B"])
    fireEvent.click(await chevron("A"))
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith("Could not load the child terms."))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /label A$/ })).toHaveAttribute("aria-expanded", "false")
  })
})
