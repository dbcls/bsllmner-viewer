import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"
import type { Clause } from "~/lib/api/types"
import { fieldLabel } from "~/lib/labels"

import { renderWithQuery } from "../query"

const FIELDS = ["cell_line", "disease", "tissue"]

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (path: string) => {
    if (path === "/api/dataset") {
      const fields = FIELDS.map((name) => ({ name, multiValued: true, ontologies: [], mappedBiosampleCount: 1 }))
      return ok({ datasetVersion: { name: "test" }, fields, targetAssays: [], assays: [], organisms: [], ontologies: [], totals: { biosample: 1, experiment: 0, bioproject: 0 } })
    }
    return ok({ elements: [], total: 0 })
  }
  return { ...original, api: { ...original.api, GET } }
})

import { ConditionPanel } from "~/features/workspace/condition-panel"
import type { Condition } from "~/features/workspace/use-condition"

const fakeCondition = (selected: Clause[]) =>
  ({
    selected,
    parseError: null,
    keywordText: "",
    labels: {},
    isSelected: () => false,
    toggle: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    removeField: vi.fn(async () => true),
    replaceField: vi.fn(async () => true),
    setKeyword: vi.fn(async () => true),
  }) as unknown as Condition

const status = (field: string): Clause => ({ field: `${field}_status`, value: "mapped" })
const dates = (from: string, to: string): Clause => ({ field: "date_published", from, to })

/** The label that the Status field select shows. */
const statusField = () => screen.getByRole("combobox", { name: "Status field" }).querySelector("[aria-hidden=false]")?.textContent

const renderPanel = async (selected: Clause[]) => {
  const view = renderWithQuery(<ConditionPanel q="x" condition={fakeCondition(selected)} onAddTerm={() => undefined} />)
  // The select has the fields of the dataset once the dataset has loaded.
  await vi.waitFor(() => expect(statusField()).toBeTruthy())
  return (next: Clause[]) => view.rerender(<ConditionPanel q="x" condition={fakeCondition(next)} onAddTerm={() => undefined} />)
}

const chooseStatusField = async (field: string) => {
  await userEvent.click(screen.getByRole("combobox", { name: "Status field" }))
  await userEvent.click(screen.getByRole("option", { name: fieldLabel(field) }))
}

describe("the Status field select of the condition panel", () => {
  it("shows the first field of the dataset while no field has a status condition", async () => {
    await renderPanel([])
    expect(statusField()).toBe(fieldLabel("cell_line"))
  })

  it("moves to the first field with a status condition when the condition gets one", async () => {
    const rerender = await renderPanel([])
    rerender([status("tissue")])
    expect(statusField()).toBe(fieldLabel("tissue"))
  })

  it("keeps a chosen field while the field still has a status condition, and moves when the field loses it", async () => {
    const rerender = await renderPanel([status("disease"), status("tissue")])
    expect(statusField()).toBe(fieldLabel("disease"))
    await chooseStatusField("tissue")
    rerender([status("disease"), status("tissue"), status("cell_line")])
    expect(statusField()).toBe(fieldLabel("tissue"))
    rerender([status("disease")])
    expect(statusField()).toBe(fieldLabel("disease"))
  })

  it("keeps a chosen field without a status condition while the fields with a status condition stay the same", async () => {
    const rerender = await renderPanel([status("disease")])
    await chooseStatusField("cell_line")
    rerender([status("disease")])
    expect(statusField()).toBe(fieldLabel("cell_line"))
  })
})

describe("the date boxes of the condition panel", () => {
  it("show the range of the condition, and start over from it when the range changes", async () => {
    const rerender = await renderPanel([dates("2019-01-01", "2019-12-31")])
    const from = screen.getByLabelText("Published from")
    const to = screen.getByLabelText("Published to")
    expect(from).toHaveValue("2019-01-01")
    expect(to).toHaveValue("2019-12-31")
    rerender([dates("2020-02-02", "2020-03-03")])
    expect(from).toHaveValue("2020-02-02")
    expect(to).toHaveValue("2020-03-03")
    rerender([])
    expect(from).toHaveValue("")
    expect(to).toHaveValue("")
  })
})
