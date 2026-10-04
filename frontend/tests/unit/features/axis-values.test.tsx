import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { elementNoun, limitAlert, replaceTerms } from "~/features/workspace/axis/axis-terms"
import { AxisTermsDialog } from "~/features/workspace/axis/axis-terms-dialog"

import { renderWithQuery } from "../query"

const FIELDS = ["disease", "cell_line"]

const renderDialog = (dimension: string) =>
  renderWithQuery(
    <AxisTermsDialog
      open
      onClose={vi.fn()}
      title="Columns"
      unit="biosample"
      dimension={dimension}
      dimensions={[{ value: dimension, label: dimension }]}
      fields={FIELDS}
      elements={[{ value: "RNA-Seq", label: "RNA-Seq" }]}
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

describe("the elements of an axis that is not an annotation field", () => {
  it("are values, and the elements of an annotation field are terms", () => {
    expect(elementNoun("library_strategy", FIELDS)).toBe("value")
    expect(elementNoun("organism_id", FIELDS)).toBe("value")
    expect(elementNoun("disease", FIELDS)).toBe("term")
  })

  it("are called values in the alerts about the limit and about a pasted list", async () => {
    const limit = { max: 100, subject: "A heatmap axis", noun: "value" as const }
    expect(limitAlert(limit)).toBe("A heatmap axis shows up to 100 values.")
    const resolve = async () => ({ terms: ["RNA-Seq", "ChIP-Seq"], missed: 0, rejected: 1 })
    expect(await replaceTerms(["RNA-Seq", "ChIP-Seq", "x"], resolve, limit)).toEqual({ terms: ["RNA-Seq", "ChIP-Seq"], alert: "2 of 3 values recognized, 1 not valid." })
    const three = ["RNA-Seq", "ChIP-Seq", "ATAC-seq"]
    expect(await replaceTerms(three, async () => ({ terms: three, missed: 0, rejected: 0 }), { ...limit, max: 2 })).toEqual({
      terms: ["RNA-Seq", "ChIP-Seq"],
      alert: "The first 2 of 3 values are shown.",
    })
    expect(await replaceTerms(["x"], async () => ({ terms: [], missed: 1, rejected: 0 }), limit)).toEqual({ terms: null, alert: "No values recognized." })
  })

  it("are values in the pasted list and its Replace button", async () => {
    const user = userEvent.setup()
    renderDialog("library_strategy")
    await user.click(screen.getByRole("radio", { name: "Paste list" }))
    expect(screen.getByRole("textbox", { name: "Values, one per line" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Replace values" })).toBeInTheDocument()
  })

  it("leaves the terms of an annotation field called terms in the pasted list and its Replace button", async () => {
    const user = userEvent.setup()
    renderDialog("disease")
    await user.click(screen.getByRole("radio", { name: "Paste list" }))
    expect(screen.getByRole("textbox", { name: "Terms, one per line" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Replace terms" })).toBeInTheDocument()
  })
})
