import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

const net = vi.hoisted(() => ({ units: [] as (string | undefined)[] }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = async (_path: string, init: { params: { query: { unit?: string } } }) => {
    net.units.push(init.params.query.unit)
    return ok({ field: "tissue", query: "", populationQ: null, unit: init.params.query.unit, terms: [] })
  }
  return { ...original, api: { ...original.api, GET } }
})

import { AxisTermsDialog } from "~/features/workspace/axis/axis-terms-dialog"
import { findTermId } from "~/features/workspace/axis/find-term"
import { TermPicker } from "~/features/workspace/term-picker/term-picker"

const renderAxis = (unit: "biosample" | "sra-experiment" | "bioproject") =>
  renderWithQuery(
    <AxisTermsDialog
      open
      onClose={vi.fn()}
      title="Row terms"
      unit={unit}
      dimension="tissue"
      dimensions={[{ value: "tissue", label: "Tissue" }]}
      fields={["tissue"]}
      elements={[]}
      pending={null}
      explicit={false}
      limit={10}
      q={null}
      selectedNote="in axis"
      onDimension={vi.fn()}
      onPick={vi.fn()}
      onRemove={vi.fn()}
      onReset={vi.fn()}
      onReplace={vi.fn()}
      replacing={false}
    />,
  )

describe("AxisTermsDialog", () => {
  it.each(["biosample", "sra-experiment", "bioproject"] as const)("searches terms counted in the unit %s of the view", async (unit) => {
    net.units.length = 0
    renderAxis(unit)
    await screen.findByText("No matching term. Try a synonym, or search the word as a keyword instead.")
    expect(net.units).toEqual([unit])
  })
})

describe("TermPicker", () => {
  it("counts BioSamples whatever the unit of the views", async () => {
    net.units.length = 0
    renderWithQuery(<TermPicker open onClose={vi.fn()} fields={["tissue"]} q={null} isSelected={() => false} onPick={vi.fn()} />)
    await screen.findByText("No matching term. Try a synonym, or search the word as a keyword instead.")
    expect(net.units).toEqual(["biosample"])
  })
})

describe("findTermId", () => {
  it("looks the label up in the unit of the view", async () => {
    net.units.length = 0
    await findTermId("tissue", "liver", "bioproject")
    expect(net.units).toEqual(["bioproject"])
  })
})
