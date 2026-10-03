import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { wrapper } from "../query"

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string) => {
    if (path === "/api/dataset") {
      return ok({ datasetVersion: { name: "test" }, fields: [], targetAssays: [], assays: [], organisms: [], ontologies: [], totals: { biosample: 1, experiment: 0, bioproject: 0 } })
    }
    return ok({ elements: [], total: 0 })
  }
  return { ...original, api: { GET, POST: GET } }
})

import { ConditionPanel } from "~/features/workspace/condition-panel"
import type { Condition } from "~/features/workspace/use-condition"

const setKeyword = vi.fn<(text: string) => Promise<boolean>>()
const replaceField = vi.fn<(field: string, clause: unknown) => Promise<boolean>>()
const removeField = vi.fn<(field: string) => Promise<boolean>>()

const conditionOf = (keywordText = "") => ({ ast: null, labels: {}, selected: [], keywordText, isSelected: () => false, setKeyword, replaceField, removeField }) as unknown as Condition

const panel = (condition: Condition) => <ConditionPanel q={null} condition={condition} onAddTerm={() => undefined} />

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  setKeyword.mockResolvedValue(true)
  replaceField.mockResolvedValue(true)
  removeField.mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe("Keyword box", () => {
  it("applies the typed words when the box loses focus before the typing pause ends", async () => {
    render(panel(conditionOf()), { wrapper })
    const box = screen.getByRole("textbox", { name: "Keyword" })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: "cancer" } })
    await advance(200)
    fireEvent.blur(box)
    await advance(0)
    expect(setKeyword).toHaveBeenCalledExactlyOnceWith("cancer")
    expect(box).toHaveValue("cancer")
    await advance(1000)
    expect(setKeyword).toHaveBeenCalledOnce()
  })

  it("applies once when Enter comes before the typing pause ends", async () => {
    render(panel(conditionOf()), { wrapper })
    const box = screen.getByRole("textbox", { name: "Keyword" })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: "liver" } })
    fireEvent.keyDown(box, { key: "Enter" })
    await advance(1000)
    expect(setKeyword).toHaveBeenCalledExactlyOnceWith("liver")
  })

  it("waits for the end of a composition before the typing pause starts", async () => {
    render(panel(conditionOf()), { wrapper })
    const box = screen.getByRole("textbox", { name: "Keyword" })
    fireEvent.focus(box)
    fireEvent.compositionStart(box)
    fireEvent.change(box, { target: { value: "かんぞう" } })
    await advance(2000)
    expect(setKeyword).not.toHaveBeenCalled()
    fireEvent.compositionEnd(box)
    await advance(600)
    expect(setKeyword).toHaveBeenCalledExactlyOnceWith("かんぞう")
  })
})

describe("Publication date", () => {
  it("applies a finished range when a date box loses focus before the typing pause ends", async () => {
    render(panel(conditionOf()), { wrapper })
    const from = screen.getByLabelText("Published from")
    const to = screen.getByLabelText("Published to")
    fireEvent.focus(from)
    fireEvent.change(from, { target: { value: "2020-01-01" } })
    fireEvent.change(to, { target: { value: "2020-12-31" } })
    await advance(100)
    fireEvent.blur(to)
    expect(replaceField).toHaveBeenCalledExactlyOnceWith("date_published", { field: "date_published", from: "2020-01-01", to: "2020-12-31" })
    await advance(1000)
    expect(replaceField).toHaveBeenCalledOnce()
  })

  it("takes the date clauses off through removeField when All is pressed", async () => {
    render(panel(conditionOf()), { wrapper })
    fireEvent.click(screen.getByRole("button", { name: "All" }))
    await advance(0)
    expect(removeField).toHaveBeenCalledExactlyOnceWith("date_published")
  })

  it("does not apply when the focus moves from one date box to the other", async () => {
    render(panel(conditionOf()), { wrapper })
    const from = screen.getByLabelText("Published from")
    const to = screen.getByLabelText("Published to")
    fireEvent.change(from, { target: { value: "2020-01-01" } })
    fireEvent.blur(from, { relatedTarget: to })
    expect(replaceField).not.toHaveBeenCalled()
  })

  it("does not apply a reversed range on blur", async () => {
    render(panel(conditionOf()), { wrapper })
    const from = screen.getByLabelText("Published from")
    fireEvent.change(from, { target: { value: "2020-01-01" } })
    fireEvent.change(screen.getByLabelText("Published to"), { target: { value: "2019-01-01" } })
    fireEvent.blur(from)
    await advance(1000)
    expect(replaceField).not.toHaveBeenCalled()
  })
})
