import { expect, test } from "@playwright/test"

import { axisHeader, cell, expectChosen, expectParam, expectQ, termPicker, viewTabs, workspaceUrl } from "./helpers"

const MCF7 = "CVCL:0031"

test.describe("heatmap", () => {
  test("a cell opens the record list narrowed to the cell, and going back restores the condition", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "heatmap", q: "library_strategy:ChIP-Seq" }))
    const count = (await cell(page, "MCF-7", "ATAC-seq").innerText()).trim()
    await cell(page, "MCF-7", "ATAC-seq").click()
    await expectQ(page, `cell_line:"${MCF7}" AND library_strategy:ATAC-seq`)
    await expectParam(page, "tab", null)
    await expect(viewTabs(page).getByRole("link", { name: "Samples" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("main")).toContainText(`${count} BioSamples match`)
    await page.goBack()
    await expectQ(page, "library_strategy:ChIP-Seq")
    await expectParam(page, "tab", "heatmap")
    await expect(cell(page, "MCF-7", "ATAC-seq")).toBeVisible()
  })

  test("a cell narrows to the population of the table, not to the condition on its own fields", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "heatmap", q: `(cell_line:"${MCF7}" OR cell_line:"CVCL:0027") AND title:run1`, unit: "sra-experiment" }))
    await expect(page.getByRole("main").getByText("Not filtered by Cell line or Assay")).toBeVisible()
    await cell(page, "K-562", "RNA-Seq").click()
    await expectQ(page, 'title:run1 AND cell_line:"CVCL:0004" AND library_strategy:RNA-Seq')
    await expectParam(page, "unit", "sra-experiment")
  })

  test("a cell without records is not a button", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "heatmap", row: "disease", col: "tissue" }))
    const empty = cell(page, "lung adenocarcinoma", "lung")
    await expect(empty).toBeVisible()
    await expect(empty).toHaveText(/^[0·]$/)
    await expect(page.getByRole("button", { name: /^lung adenocarcinoma × lung:/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^type 2 diabetes mellitus × blood:/ })).toHaveCount(1)
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
    await expectChosen(page.getByRole("combobox", { name: "Row dimension" }), "Assay")
    await expect(cell(page, "ATAC-seq", "MCF-7")).toBeVisible()
    await page.getByRole("radio", { name: "Residual" }).click()
    await expectParam(page, "color", "residual")
    await expect(page.getByRole("main")).toContainText("r ≤ −4")
  })
})
