import { act, fireEvent, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRef, useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Update } from "~/features/workspace/state"
import type * as Client from "~/lib/api/client"
import { DEFAULTS, type Patch, type WorkspaceState } from "~/lib/workspace-state"

import { renderWithQuery } from "../query"

const net = vi.hoisted(() => ({ answered: new Set<string>(), termsGate: null as Promise<void> | null, termsStatus: (_query: string): number | null => null }))

const VERSION = { name: "test", createdAt: "2026-10-03T00:00:00Z", model: "m", digest: "0000000000000000" }
const label = (value: string) => `label ${value}`

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok, failure } = await import("../query")
  const GET = async (path: string, init?: { params?: { query?: Record<string, unknown> } }) => {
    const query = init?.params?.query ?? {}
    if (path === "/api/dataset") {
      const field = (name: string) => ({ name, multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 0 })
      const data = { datasetVersion: VERSION, version: {}, targetAssays: ["RNA-Seq"], assays: [], fields: [field("disease"), field("cell_type")], dslFields: [], statuses: {}, totals: { biosample: 1, experiment: 1, bioproject: 1 }, organisms: [], ontologies: [] }
      return ok(data)
    }
    if (path === "/api/terms") {
      await net.termsGate
      const status = net.termsStatus(String(query["query"]))
      if (status !== null) return failure(status)
      const terms = ["T:9"].map((termId) => ({ field: "disease", termId, label: label(termId), ontology: "T", path: [], descendantCount: 0, count: 1, matchedSynonym: null, clauses: [] }))
      return ok({ field: "disease", query: "", populationQ: null, unit: "biosample", terms })
    }
    // The first answer of a view arrives. Every later request never answers, as on a slow network.
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
import { useCondition } from "~/features/workspace/use-condition"

type View = typeof TrendTab | typeof HeatmapTab

/**
 * A view whose state is kept here as the page keeps it in the URL, so that every change of the view reaches the next
 * render.
 */
const Harness = ({ View, initial, onUpdate, onAlert }: { View: View; initial: WorkspaceState; onUpdate: (patch: Patch) => void; onAlert: (message: string) => void }) => {
  const [state, setState] = useState(initial)
  const latest = useRef(initial)
  const update: Update = (patch) => {
    onUpdate(patch)
    latest.current = { ...latest.current, ...patch }
    setState(latest.current)
  }
  const condition = useCondition(state.q, update, () => latest.current)
  // The pending state is kept above the view, as the page keeps it, so the state stays when the user leaves the view.
  const [replacing, setReplacing] = useState(false)
  const [shown, setShown] = useState(true)
  return (
    <>
      <button onClick={() => setShown((was) => !was)}>Toggle view</button>
      <button onClick={() => update({ row: "cell_type", col: "library_strategy", trendField: "cell_type" })}>Switch dimension</button>
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
  net.termsStatus = () => null
})

/** Holds the answers of the term search until the returned function is called. */
const holdTermSearch = () => {
  let resolveGate: () => void = () => undefined
  net.termsGate = new Promise<void>((resolve) => {
    resolveGate = resolve
  })
  return () => act(async () => resolveGate())
}

describe("TrendTab while the trend of the new terms loads", () => {
  it("adds a term after another was removed, counting the terms that the URL names", async () => {
    const user = userEvent.setup()
    const { onUpdate, onAlert } = renderView(TrendTab, { tab: "trend", trendField: "disease", trendTerms: FIVE })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    await user.click(await within(dialog).findByRole("button", { name: /label T:9/ }))
    expect(onAlert).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenLastCalledWith({ trendTerms: ["T:2", "T:3", "T:4", "T:5", "T:9"] })
  })

  it("keeps a term removed when another is removed", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(TrendTab, { tab: "trend", trendField: "disease", trendTerms: FIVE })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    await user.click(within(dialog).getByRole("button", { name: "Remove label T:2" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ trendTerms: ["T:3", "T:4", "T:5"] })
  })
})

describe("HeatmapTab while the cross-tabulation of the new terms loads", () => {
  it("keeps a row removed when another is removed", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    const dialog = await openTerms(user, "Rows")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    await user.click(within(dialog).getByRole("button", { name: "Remove label T:2" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: ["T:3", "T:4", "T:5"] })
  })
})

describe("TrendTab with the most lines that a trend shows", () => {
  it("does not add a found term to a trend of 5 lines and says so", async () => {
    const user = userEvent.setup()
    const { onUpdate, onAlert } = renderView(TrendTab, { tab: "trend", trendField: "disease", trendTerms: FIVE })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: /label T:9/ }))
    expect(onAlert).toHaveBeenLastCalledWith("A trend shows up to 5 terms.")
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe("HeatmapTab with the most terms that the api takes on an axis", () => {
  const FULL = Array.from({ length: 100 }, (_, index) => `F:${index}`)

  it("does not add a found term to an axis of 100 terms and says so", async () => {
    const user = userEvent.setup()
    const { onUpdate, onAlert } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FULL })
    const dialog = await openTerms(user, "Rows")
    await user.click(await within(dialog).findByRole("button", { name: /label T:9/ }))
    expect(onAlert).toHaveBeenLastCalledWith("A heatmap axis shows up to 100 terms.")
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("removes a term from an axis of 100 terms", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FULL })
    const dialog = await openTerms(user, "Rows")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label F:0" }))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: FULL.slice(1) })
  })

  it("uses the first 100 of a longer pasted list and says so", async () => {
    const user = userEvent.setup()
    const { onUpdate, onAlert } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    const dialog = await openTerms(user, "Rows")
    await user.click(within(dialog).getByRole("radio", { name: "Paste list" }))
    const pasted = Array.from({ length: 101 }, (_, index) => `P:${index}`)
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Terms, one per line" }), { target: { value: pasted.join("\n") } })
    await user.click(within(dialog).getByRole("button", { name: "Replace terms" }))
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith("The first 100 of 101 terms are shown."))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: pasted.slice(0, 100) })
  })
})

describe("an axis with its last term removed", () => {
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

  it("writes the other top terms when a top term of the lines is removed and no terms are chosen", async () => {
    const user = userEvent.setup()
    const { onUpdate } = renderView(TrendTab, { tab: "trend", trendField: "disease" })
    const dialog = await openTerms(user, "Lines")
    await user.click(await within(dialog).findByRole("button", { name: "Remove label T:1" }))
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ trendTerms: ["T:2", "T:3", "T:4", "T:5"] })
  })

  it("writes the other top rows when a top row is removed and no terms are chosen", async () => {
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
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Terms, one per line" }), { target: { value: "some label" } })
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
    expect(onUpdate).toHaveBeenLastCalledWith({ row: "cell_type", col: "library_strategy", trendField: "cell_type" })
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
    fireEvent.change(within(reopened).getByRole("textbox", { name: "Terms, one per line" }), { target: { value: "another label" } })
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
    fireEvent.change(within(reopened).getByRole("textbox", { name: "Terms, one per line" }), { target: { value: "another label" } })
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
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith("1 of 1 terms recognized."))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: ["T:9"] })
  })

  it("replaces the terms when nothing changed while it waited", async () => {
    const user = userEvent.setup()
    const open = holdTermSearch()
    const { onUpdate, onAlert } = renderView(HeatmapTab, { tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE })
    const dialog = await openTerms(user, "Rows")
    await paste(user, dialog)
    await open()
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith("1 of 1 terms recognized."))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: ["T:9"] })
  })
})

describe("Paste list when the api does not answer for some lines", () => {
  const paste = async (user: ReturnType<typeof userEvent.setup>, lines: string[], setReplacing = vi.fn()) => {
    const onUpdate = vi.fn<(patch: Patch) => void>()
    const onAlert = vi.fn<(message: string) => void>()
    const latest = () => ({ ...DEFAULTS, row: "disease" })
    const View = () => (
      <HeatmapTab
        state={{ ...DEFAULTS, tab: "heatmap", row: "disease", col: "library_strategy", rowTerms: FIVE }}
        condition={useCondition(null, onUpdate, latest)}
        update={onUpdate}
        latest={latest}
        replacing={false}
        setReplacing={setReplacing}
        onAlert={onAlert}
      />
    )
    renderWithQuery(<View />)
    const dialog = await openTerms(user, "Rows")
    await user.click(within(dialog).getByRole("radio", { name: "Paste list" }))
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Terms, one per line" }), { target: { value: lines.join("\n") } })
    await user.click(within(dialog).getByRole("button", { name: "Replace terms" }))
    return { onUpdate, onAlert, setReplacing }
  }

  it("uses the other lines and reports the lines that the api rejects", async () => {
    net.termsStatus = (query) => (query === "too long" ? 422 : null)
    const { onUpdate, onAlert } = await paste(userEvent.setup(), ["A:1", "too long", "liver"])
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith("2 of 3 terms recognized, 1 not valid."))
    expect(onUpdate).toHaveBeenLastCalledWith({ rowTerms: ["A:1", "T:9"] })
  })

  it("says that the terms could not be looked up when the server fails, and makes the axis wait for nothing", async () => {
    net.termsStatus = () => 500
    const { onUpdate, onAlert, setReplacing } = await paste(userEvent.setup(), ["liver"])
    await vi.waitFor(() => expect(onAlert).toHaveBeenCalledWith("Could not look up the terms."))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(setReplacing).toHaveBeenLastCalledWith(false)
  })
})
