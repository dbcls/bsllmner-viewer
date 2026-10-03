import { renderHook } from "@testing-library/react"
import fc from "fast-check"
import { describe, expect, it, vi } from "vitest"

import { useReplaceUnofferedDimensions } from "~/features/workspace/use-offered-dimensions"
import { crosstabAxes, offeredDimensionsPatch, trendAxis, trendLineField, trendParams } from "~/features/workspace/view-requests"
import { DEFAULTS, readState, type WorkspaceState } from "~/lib/workspace-state"

const FIELDS = ["cell_line", "tissue", "disease"]
const at = (search: string): WorkspaceState => readState(new URLSearchParams(search))

describe("offeredDimensionsPatch", () => {
  it("replaces a row that the dataset lacks with the row that the view draws", () => {
    const state = at("tab=heatmap&row=bogus&col=cell_line&row_terms=a,b")
    const patch = offeredDimensionsPatch(state, FIELDS)
    expect(patch).toEqual({ row: crosstabAxes(state, FIELDS).row, rowTerms: null })
  })

  it("replaces a column that the dataset lacks and keeps the row", () => {
    const state = at("tab=heatmap&row=cell_line&col=bogus")
    const patch = offeredDimensionsPatch(state, FIELDS)
    expect(patch).toEqual({ col: crosstabAxes(state, FIELDS).col, colTerms: null })
  })

  it("replaces a trend field that the dataset lacks", () => {
    const state = at("tab=trend&trend_field=bogus&trend_terms=a")
    expect(offeredDimensionsPatch(state, FIELDS)).toEqual({ trendField: trendLineField(state, FIELDS), trendTerms: null })
  })

  it("replaces a trend field that is a Heatmap dimension only", () => {
    const state = at("tab=trend&trend_field=date_published&trend_terms=2020")
    expect(offeredDimensionsPatch(state, FIELDS)).toEqual({ trendField: trendLineField(state, FIELDS), trendTerms: null })
    expect(trendLineField(state, FIELDS)).not.toBe("date_published")
  })

  it("replaces nothing when the dimensions are offered", () => {
    expect(offeredDimensionsPatch(at("tab=heatmap&row=cell_line&col=tissue"), FIELDS)).toBeNull()
    expect(offeredDimensionsPatch(at("tab=trend&trend_field=organism_id"), FIELDS)).toBeNull()
    expect(offeredDimensionsPatch(DEFAULTS, FIELDS)).toBeNull()
  })

  it("replaces nothing before the dataset is known, or on a tab without dimensions", () => {
    expect(offeredDimensionsPatch(at("tab=heatmap&row=bogus"), null)).toBeNull()
    expect(offeredDimensionsPatch(at("tab=samples&row=bogus&trend_field=bogus"), FIELDS)).toBeNull()
  })

  it("leaves a URL that draws what it names and that a second replacement would not change", () => {
    const name = fc.oneof(fc.constantFrom(...FIELDS, "library_strategy", "organism_id", "date_published"), fc.string({ maxLength: 8 }))
    fc.assert(
      fc.property(fc.constantFrom("heatmap", "trend"), name, name, name, fc.subarray(FIELDS), (tab, row, col, field, offered) => {
        const params = new URLSearchParams({ tab, row, col, trend_field: field })
        const state = readState(params)
        const patch = offeredDimensionsPatch(state, offered)
        const next = { ...state, ...patch }
        expect(offeredDimensionsPatch(next, offered)).toBeNull()
        if (tab === "heatmap") {
          const drawn = crosstabAxes(state, offered)
          expect(crosstabAxes(next, offered)).toEqual(drawn)
          expect(next.row).toBe(drawn.row)
          expect(next.col).toBe(drawn.col)
        }
        if (tab === "trend") expect(next.trendField).toBe(trendLineField(state, offered))
      }),
    )
  })
})

describe("useReplaceUnofferedDimensions", () => {
  const dataset = (fields: string[], isPlaceholderData = false) => ({ data: { fields: fields.map((name) => ({ name })) }, isPlaceholderData })

  it("replaces the URL, not adding a history entry, once the current dataset is known", () => {
    const update = vi.fn()
    renderHook(() => useReplaceUnofferedDimensions(at("tab=heatmap&row=bogus&col=cell_line"), update, dataset(FIELDS)))
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({ replace: true })
  })

  it("waits while the dataset is the copy of the last visit", () => {
    const update = vi.fn()
    renderHook(() => useReplaceUnofferedDimensions(at("tab=heatmap&row=bogus&col=cell_line"), update, dataset(FIELDS, true)))
    expect(update).not.toHaveBeenCalled()
  })

  it("replaces once the dataset of the server arrives after the copy of the last visit, and then no more", () => {
    const update = vi.fn()
    const state = at("tab=heatmap&row=bogus&col=cell_line")
    const { rerender } = renderHook((props: { state: WorkspaceState; placeholder: boolean }) => useReplaceUnofferedDimensions(props.state, update, dataset(FIELDS, props.placeholder)), {
      initialProps: { state, placeholder: true },
    })
    expect(update).not.toHaveBeenCalled()
    rerender({ state, placeholder: false })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({ replace: true })
    rerender({ state: { ...state, ...update.mock.calls[0]?.[0] }, placeholder: false })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("does nothing without a dataset or when the dimensions are offered", () => {
    const update = vi.fn()
    renderHook(() => useReplaceUnofferedDimensions(at("tab=heatmap&row=bogus"), update, { data: undefined, isPlaceholderData: false }))
    renderHook(() => useReplaceUnofferedDimensions(at("tab=heatmap&row=cell_line&col=tissue"), update, dataset(FIELDS)))
    expect(update).not.toHaveBeenCalled()
  })
})

describe("trendParams while the dataset is not the current one", () => {
  it("sends no terms of a trend field that the dataset lacks", () => {
    const state = at("tab=trend&trend_field=bogus&trend_terms=MONDO:1")
    expect(trendParams(state, FIELDS).elements).toBeUndefined()
    expect(trendAxis(state, FIELDS).terms).toBeNull()
  })

  it("sends the terms of an offered field, and before the dataset is known", () => {
    const state = at("tab=trend&trend_field=disease&trend_terms=MONDO:1")
    expect(trendParams(state, FIELDS).elements).toBe("MONDO:1")
    expect(trendParams(state, null).elements).toBe("MONDO:1")
  })
})
