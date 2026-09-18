import { expect, test } from "@playwright/test"

import { axisHeader, cell, expectParam, expectQ, termPicker, workspaceUrl } from "./helpers"

const MCF7 = "CVCL:0031"

test.describe("heatmap", () => {
  test("clicking a cell adds its row and column clauses, and clicking it again removes both", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "heatmap" }))
    await cell(page, "MCF-7", "ATAC-seq").click()
    await expectQ(page, `cell_line:"${MCF7}" AND library_strategy:ATAC-seq`)
    await expect(cell(page, "MCF-7", "ATAC-seq")).toHaveAttribute("aria-pressed", "true")
    await expect(cell(page, "MCF-7", "ChIP-Seq")).toHaveAttribute("aria-pressed", "false")
    await expect(cell(page, "HepG2", "ATAC-seq")).toHaveAttribute("aria-pressed", "false")
    await cell(page, "MCF-7", "ATAC-seq").click()
    await expectQ(page, null)
    await expect(cell(page, "MCF-7", "ATAC-seq")).toHaveAttribute("aria-pressed", "false")
  })

  test("a cell whose row is already in the condition adds only its column", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "heatmap", q: `cell_line:"${MCF7}"` }))
    await cell(page, "MCF-7", "RNA-Seq").click()
    await expectQ(page, `cell_line:"${MCF7}" AND library_strategy:RNA-Seq`)
  })

  test("picking an axis term from the picker pins the axis in the URL and Top 10 releases it", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "heatmap" }))
    await expect(axisHeader(page, "Row")).toContainText("4 terms (top 10)")
    await axisHeader(page, "Row").getByRole("button", { name: "+ Add term" }).click()
    const picker = termPicker(page)
    await expect(picker).toContainText("Adds to rows")
    await picker.getByRole("button").filter({ hasText: "CVCL:0030" }).click()
    await expectParam(page, "row_terms", "CVCL:0031,CVCL:0027,CVCL:0004")
    await expect(picker).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(picker).toBeHidden()
    await expect(axisHeader(page, "Row")).toContainText("3 terms")
    await expect(axisHeader(page, "Row")).not.toContainText("top 10")
    await axisHeader(page, "Row").getByRole("button", { name: "Top 10" }).click()
    await expectParam(page, "row_terms", null)
    await expect(axisHeader(page, "Row")).toContainText("4 terms (top 10)")
  })

  test("swapping the axes and choosing residual colors are carried by the URL", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "heatmap" }))
    await page.getByRole("button", { name: "Swap axes" }).click()
    await expectParam(page, "row", "library_strategy")
    await expectParam(page, "col", "cell_line")
    await expect(page.getByRole("combobox", { name: "Row dimension" })).toHaveValue("library_strategy")
    await expect(cell(page, "ATAC-seq", "MCF-7")).toBeVisible()
    await page.getByRole("radio", { name: "Residual" }).click()
    await expectParam(page, "color", "residual")
    await expect(page.getByRole("main")).toContainText("r ≤ −4")
  })
})
