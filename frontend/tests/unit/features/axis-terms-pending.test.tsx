import { act, fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRef, useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Update } from "~/features/workspace/state"
import type * as Client from "~/lib/api/client"
import { DEFAULTS, type Patch, type WorkspaceState } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

const net = vi.hoisted(() => ({ answered: new Set<string>(), termsGate: null as Promise<void> | null }))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const label = (value: string) => `label ${value}`

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: Record<string, unknown> } }) => {
    const query = init?.params?.query ?? {}
    if (path === "/api/dataset") {
      const field = { name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 0 }
      const data = { datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] }
      return ok(data)
    }
    if (path === "/api/terms") {
      await net.termsGate
      const terms = ["T:9"].map((termId) => ({ field: "disease", termId, label: label(termId), ontology: "T", path: [], descendantCount: 0, count: 1, matchedSynonym: null, clauses: [] }))
      return ok({ field: "disease", query: "", populationQ: null, unit: "biosample", terms })
    }
    // The first answer of a view arrives; every later one stays on its way, as on a slow network.
    if (net.answered.has(path)) await new Promise(() => undefined)
    net.answered.add(path)
    const element = (value: string) => ({ value, label: label(value), clauses: [{ field: "disease", value }], count: 1 })
    if (path === "/api/trend") {
      const elements = query["elements"] === undefined ? ["T:1", "T:2", "T:3", "T:4", "T:5"] : String(query["elements"]).split(",")
      const point = { year: 2020, count: 1, clauses: [] }
      const series = elements.map((value) => ({ value, label: label(value), clauses: [], points: [point] }))
      const data = { datasetVersion: VERSION, q: null, unit: "biosample", facetSelfExclude: true, years: [2020], firstYear: 2020, lastYear: 2020, total: [point], allEntries: [point], totalPopulationQ: null, field: "disease", populationQ: null, series }
      return ok(data)
    }
    if (path === "/api/crosstab") {
      const rowValues = query["rowElements"] === undefined ? ["T:1", "T:2", "T:3", "T:4", "T:5"] : String(query["rowElements"]).split(",")
      const rows = rowValues.map((value) => ({ ...element(value), countExact: 0, countSelected: 0, hasChildren: false, parents: [] }))
      const data = { datasetVersion: VERSION, q: null, populationQ: null, rowField: "disease", colField: "library_strategy", unit: "biosample", facetSelfExclude: true, total: 1, rows, cols: [element("RNA-Seq")], cells: [] }
      return ok(data)
    }
    throw new Error(`unexpected request ${path}`)
  }
  return { ...original, api: { ...original.api, GET } }
})

import { HeatmapTab } from "~/features/workspace/heatmap/heatmap-tab"
import { TrendTab } from "~/features/workspace/trend/trend-tab"
import type { Condition } from "~/features/workspace/use-condition"

const condition = { isSelected: () => false, toggle: vi.fn(), toggleNarrow: vi.fn() } as unknown as Condition

type View = typeof TrendTab | typeof HeatmapTab

/** A view whose state lives here as it lives in the URL, so that every change of the view reaches the next render. */
const Harness = ({ View, initial, onUpdate, onAlert }: { View: View; initial: WorkspaceState; onUpdate: (patch: Patch) => void; onAlert: (message: string) => void }) => {
  const [state, setState] = useState(initial)
  const latest = useRef(initial)
  const update: Update = (patch) => {
    onUpdate(patch)
    latest.current = { ...latest.current, ...patch }
    setState(latest.current)
  }
  // The pending state lives above the view, as it lives in the page, so it survives leaving the view.
  const [replacing, setReplacing] = useState(false)
  const [shown, setShown] = useState(true)
  return (
    <>
      <button onClick={() => setShown((was) => !was)}>Toggle view</button>
      <button onClick={() => update({ row: "cell_type", col: "assay", trendField: "cell_type" })}>Switch dimension</button>
      <button onClick={() => update({ tab: "samples" })}>Switch tab</button>
      {shown && <View state={state} condition={condition} update={update} latest={() => latest.current} replacing={replacing} setReplacing={setReplacing} onAlert={onAlert} />}
    </>
  )
}

const FIVE = ["T:1", "T:2", "T:3", "T:4", "T:5"]

const renderView = (View: View, initial: Partial<WorkspaceState>) => {
  const onUpdate = vi.fn<(patch: Patch) => void>()
  const onAlert = vi.fn<(message: string) => void>()
  renderWithQuery(<Harness View={View} initial={{ ...DEFAULTS, ...initial }} onUpdate={onUpdate} onAlert={onAlert} />)
  return { onUpdate, onAlert }
}

const openTerms = async (user: ReturnType<typeof userEvent.setup>, axis: string) => {
  await user.click(await within(screen.getByRole("group", { name: axis })).findByRole("button", { name: /^\d+ terms?$/ }))
  return screen.getByRole("dialog")
}

beforeEach(() => {
  net.answered.clear()
  net.termsGate = null
})

/** Holds the answers of the term search until the returned function is called. */
const holdTermSearch = () => {
  let resolveGate: () => void = () => undefined
  net.termsGate = new Promise<void>((resolve) => {
    resolveGate = resolve
  })
  return () => act(async () => resolveGate())
}

describe("TrendTab while the trend of the new terms is on its way", () => {
  it("adds a term after another was taken off, counting the terms that the URL names", async () => {
    const user = userEvent.setup()
    const { onUpdate, onAlert } = renderView(TrendTab, { tab: "trend", trendField: "disease", trendTerms: FIVE })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    await user.click(await within(dialog).findByRole("button", { name: /label T:9/ }))
    expect(onAlert).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenLastCalledWith({ trendTerms: ["T:2", "T:3", "T:4", "T:5", "T:9"] })
  })

  it("keeps a term that was taken off off when another is taken off", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(TrendTab, { tab: "trend", trendField: "disease", trendTerms: FIVE })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    await user.click(within(dialog).getByRole("button", { name: "Remove label T:2" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ trendTerms: ["T:3", "T:4", "T:5"] })
  })
})

describe("HeatmapTab while the cross-tabulation of the new terms is on its way", () => {
  it("keeps a row that was taken off off when another is taken off", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    const dialog = await openTerms(user, "Rows")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    await user.click(within(dialog).getByRole("button", { name: "Remove label T:2" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: ["T:3", "T:4", "T:5"] })
  })
})

describe("HeatmapTab with the most terms that the api takes on an axis", () => {
  const FULL = Array.from({ length: 500 }, (_, index) => `F:${index}`)

  it("does not add a found term to an axis of 500 terms and says so", async () => {
    const user = userEvent.setup()
    const { onUpdate, onAlert } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FULL })
    const dialog = await openTerms(user, "Rows")
    await user.click(await within(dialog).findByRole("button", { name: /label T:9/ }))
    expect(onAlert).toHaveBeenLastCalledWith("A heatmap axis shows up to 500 terms")
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("takes a term off an axis of 500 terms", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FULL })
    const dialog = await openTerms(user, "Rows")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label F:0" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: FULL.slice(1) })
  })

  it("uses the first 500 of a longer pasted list and says so", async () => {
    const user = userEvent.setup()
    const { onUpdate, onAlert } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    const dialog = await openTerms(user, "Rows")
    await user.click(within(dialog).getByRole("radio", { name: "Paste list" }))
    const pasted = Array.from({ length: 501 }, (_, index) => `P:${index}`)
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Terms to set" }), { target: { value: pasted.join("\n") } })
    await user.click(within(dialog).getByRole("button", { name: "Replace terms" }))
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith("The first 500 of 501 terms are shown"))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: pasted.slice(0, 500) })
  })
})

describe("an axis with its last term taken off", () => {
  it("shows the top terms again on the rows", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: ["T:1"] })
    const dialog = await openTerms(user, "Rows")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: null })
  })

  it("shows the top terms again on the lines", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(TrendTab, { tab: "trend", trendField: "disease", trendTerms: ["T:1"] })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ trendTerms: null })
  })

  it("writes the other top terms when a top term of the lines is taken off and no terms are chosen", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(TrendTab, { tab: "trend", trendField: "disease" })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ trendTerms: ["T:2", "T:3", "T:4", "T:5"] })
  })

  it("writes the other top rows when a top row is taken off and no terms are chosen", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy" })
    const dialog = await openTerms(user, "Rows")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ rowTerms: ["T:2", "T:3", "T:4", "T:5"] })
  })
})

describe("a pasted list that is being resolved", () => {
  const paste = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => {
    await user.click(within(dialog).getByRole("radio", { name: "Paste list" }))
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Terms to set" }), { target: { value: "some label" } })
    await user.click(within(dialog).getByRole("button", { name: "Replace terms" }))
  }

  it("keeps Replace terms off until the entries are resolved", async () => {
    const user = userEvent.setup()
    const open = holdTermSearch()
    renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    const dialog = await openTerms(user, "Rows")
    await paste(user, dialog)
    expect(within(dialog).getByRole("button", { name: "Replace terms" })).toBeDisabled()
    await open()
    await vi.waitFor(() => expect(within(dialog).getByRole("button", { name: "Replace terms" })).toBeEnabled())
  })

  it("is dropped, without its alert, when the rows moved to another dimension while it waited", async () => {
    const user = userEvent.setup()
    const open = holdTermSearch()
    const { onUpdate, onAlert } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    const dialog = await openTerms(user, "Rows")
    await paste(user, dialog)
    fireEvent.click(screen.getByRole("button", { name: "Switch dimension" }))
    await open()
    await vi.waitFor(() => expect(within(dialog).getByRole("button", { name: "Replace terms" })).toBeEnabled())
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith({ row: "cell_type", col: "assay", trendField: "cell_type" })
    expect(onAlert).not.toHaveBeenCalled()
  })

  it("is dropped when the lines moved to another dimension while it waited", async () => {
    const user = userEvent.setup()
    const open = holdTermSearch()
    const { onUpdate, onAlert } = renderView(TrendTab, { tab: "trend", trendField: "disease", trendTerms: FIVE })
    const dialog = await openTerms(user, "Lines")
    await paste(user, dialog)
    fireEvent.click(screen.getByRole("button", { name: "Switch dimension" }))
    await open()
    await vi.waitFor(() => expect(within(dialog).getByRole("button", { name: "Replace terms" })).toBeEnabled())
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onAlert).not.toHaveBeenCalled()
  })

  it("keeps Replace terms off after the dialog was closed and opened again while the entries are resolved", async () => {
    const user = userEvent.setup()
    const open = holdTermSearch()
    renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    await paste(user, await openTerms(user, "Rows"))
    await user.keyboard("{Escape}")
    const reopened = await openTerms(user, "Rows")
    await user.click(within(reopened).getByRole("radio", { name: "Paste list" }))
    fireEvent.change(within(reopened).getByRole("textbox", { name: "Terms to set" }), { target: { value: "another label" } })
    expect(within(reopened).getByRole("button", { name: "Replace terms" })).toBeDisabled()
    await open()
  })

  it("keeps Replace terms off after the view was left and opened again while the entries are resolved", async () => {
    const user = userEvent.setup()
    const open = holdTermSearch()
    renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    await paste(user, await openTerms(user, "Rows"))
    await user.keyboard("{Escape}")
    fireEvent.click(screen.getByRole("button", { name: "Toggle view" }))
    fireEvent.click(screen.getByRole("button", { name: "Toggle view" }))
    const reopened = await openTerms(user, "Rows")
    await user.click(within(reopened).getByRole("radio", { name: "Paste list" }))
    fireEvent.change(within(reopened).getByRole("textbox", { name: "Terms to set" }), { target: { value: "another label" } })
    expect(within(reopened).getByRole("button", { name: "Replace terms" })).toBeDisabled()
    await open()
  })

  it("replaces the terms and says so when the tab changed while it waited", async () => {
    const user = userEvent.setup()
    const open = holdTermSearch()
    const { onUpdate, onAlert } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    await paste(user, await openTerms(user, "Rows"))
    fireEvent.click(screen.getByRole("button", { name: "Switch tab" }))
    await open()
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith("1 of 1 terms recognised"))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: ["T:9"] })
  })

  it("replaces the terms when nothing changed while it waited", async () => {
    const user = userEvent.setup()
    const open = holdTermSearch()
    const { onUpdate, onAlert } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    const dialog = await openTerms(user, "Rows")
    await paste(user, dialog)
    await open()
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith("1 of 1 terms recognised"))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: ["T:9"] })
  })
})
