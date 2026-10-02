import { expect, test } from "@playwright/test"

import { type Crosstab,crosstab, dataset, distribution, select, terms } from "./_api"
import { axisHeader, cell, cellButton, expectChosen, expectParam, expectQ, formatCount, pageRangeText, qOf, termPicker, viewTabs, workspaceUrl } from "./_helpers"

/** The first cell of the cross-tabulation with the given sign of count, with its row and column elements. */
const findCell = (data: Crosstab, populated: boolean) => {
  const found = data.cells.find((c) => (c.count > 0) === populated)
  const row = data.rows.find((r) => r.value === found?.row)
  const col = data.cols.find((c) => c.value === found?.col)
  if (!found || !row || !col) throw new Error(`the cross-tabulation has no cell with ${populated ? "a count above 0" : "a count of 0"}`)
  return { cell: found, row, col }
}

const residualText = (residual: number | null): string => (residual === null ? "n/a" : `${residual > 0 ? "+" : ""}${residual.toFixed(1)}`)

test.describe("heatmap", () => {
  test("a cell opens the entry list narrowed to the cell, and going back restores the condition", async ({ page, request }) => {
    const assay = (await dataset(request)).targetAssays[0]
    if (!assay) throw new Error("the dataset has no target assay")
    const q = `library_strategy:${assay}`
    const data = await crosstab(request, "cell_line", "library_strategy", { q })
    const { cell: target, row, col } = findCell(data, true)
    const narrowed = await select(request, data.populationQ, [...row.clauses, ...col.clauses], "narrow")
    await page.goto(workspaceUrl({ tab: "heatmap", q }))
    await expect(cell(page, row.label, col.label)).toHaveText(formatCount(target.count))
    await cell(page, row.label, col.label).click()
    await expectQ(page, narrowed)
    await expectParam(page, "tab", null)
    await expect(viewTabs(page).getByRole("link", { name: "Samples" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("main")).toContainText(pageRangeText(target.count))
    await page.goBack()
    await expectQ(page, q)
    await expectParam(page, "tab", "heatmap")
    await expect(cell(page, row.label, col.label)).toBeVisible()
  })

  test("a cell narrows to the population of the table, not to the condition on its own fields", async ({ page, request }) => {
    const [organism] = (await distribution(request, "organism_id")).elements
    if (!organism) throw new Error("the dataset has no organism")
    const population = await select(request, null, organism.clauses)
    const [a, b] = (await distribution(request, "cell_line", { q: population })).elements
    if (!a || !b) throw new Error("the dataset has fewer than two cell lines for the organism")
    const q = `(cell_line:"${a.value}" OR cell_line:"${b.value}") AND ${population}`
    const data = await crosstab(request, "cell_line", "library_strategy", { q, unit: "sra-experiment" })
    expect(data.populationQ).toBe(population)
    const { row, col } = findCell(data, true)
    const narrowed = await select(request, data.populationQ, [...row.clauses, ...col.clauses], "narrow")
    await page.goto(workspaceUrl({ tab: "heatmap", q, unit: "sra-experiment" }))
    await expect(page.getByRole("main").getByText("Not filtered by Cell line or Assay")).toBeVisible()
    await cell(page, row.label, col.label).click()
    await expectQ(page, narrowed)
    expect(qOf(page)).not.toContain(" OR ")
    await expectParam(page, "unit", "sra-experiment")
  })

  test("a cell with a count of 0 is not a button", async ({ page, request }) => {
    const data = await crosstab(request, "disease", "tissue")
    const empty = findCell(data, false)
    const populated = findCell(data, true)
    await page.goto(workspaceUrl({ tab: "heatmap", row: "disease", col: "tissue" }))
    const target = cell(page, empty.row.label, empty.col.label)
    await expect(target).toBeVisible()
    await expect(target).toHaveText(/^[0·]$/)
    await expect(cellButton(page, empty.row.label, empty.col.label)).toHaveCount(0)
    await expect(cell(page, populated.row.label, populated.col.label)).toHaveText(formatCount(populated.cell.count))
    await expect(cellButton(page, populated.row.label, populated.col.label)).toHaveCount(1)
  })

  test("picking an axis term from the picker pins the axis in the URL and Top 10 releases it", async ({ page, request }) => {
    const data = await crosstab(request, "cell_line", "library_strategy")
    const shown = data.rows.map((row) => row.value)
    const extra = (await terms(request, "cell_line", "")).find((term) => !shown.includes(term.termId))
    if (!extra) throw new Error("every listed cell line is already a row")
    await page.goto(workspaceUrl({ tab: "heatmap" }))
    await expect(axisHeader(page, "Row")).toContainText(`${shown.length} terms (top 10)`)
    await axisHeader(page, "Row").getByRole("button", { name: "+ Add term" }).click()
    const picker = termPicker(page)
    await expect(picker).toContainText("Adds to rows")
    await picker.getByRole("textbox", { name: "Search terms" }).fill(extra.termId)
    await picker.getByRole("button").filter({ hasText: extra.termId }).click()
    await expectParam(page, "row_terms", [...shown, extra.termId].join(","))
    await expect(picker).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(picker).toBeHidden()
    await expect(axisHeader(page, "Row")).toContainText(`${shown.length + 1} terms`)
    await expect(axisHeader(page, "Row")).not.toContainText("top 10")
    await axisHeader(page, "Row").getByRole("button", { name: "Top 10" }).click()
    await expectParam(page, "row_terms", null)
    await expect(axisHeader(page, "Row")).toContainText(`${shown.length} terms (top 10)`)
  })

  test("swapping the axes and choosing residual colors are carried by the URL", async ({ page, request }) => {
    const data = await crosstab(request, "cell_line", "library_strategy")
    const { cell: target, row, col } = findCell(data, true)
    await page.goto(workspaceUrl({ tab: "heatmap" }))
    await page.getByRole("button", { name: "Swap axes" }).click()
    await expectParam(page, "row", "library_strategy")
    await expectParam(page, "col", "cell_line")
    await expectChosen(page.getByRole("combobox", { name: "Row dimension" }), "Assay")
    await expect(cell(page, col.label, row.label)).toHaveText(formatCount(target.count))
    await page.getByRole("radio", { name: "Residual" }).click()
    await expectParam(page, "color", "residual")
    await expect(page.getByRole("main")).toContainText("r ≤ −4")
    const swapped = await crosstab(request, "library_strategy", "cell_line")
    const same = swapped.cells.find((c) => c.row === col.value && c.col === row.value)
    if (!same) throw new Error("the swapped cross-tabulation lacks the cell")
    await expect(cell(page, col.label, row.label)).toHaveText(residualText(same.residual))
  })
})
