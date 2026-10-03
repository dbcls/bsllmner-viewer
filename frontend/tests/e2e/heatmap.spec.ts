import { expect, test } from "@playwright/test"

import { type Crosstab,crosstab, dataset, distribution, get, select, terms } from "./_api"
import { axisTerms, axisTermsButton, cell, cellButton, expectChosen, expectParam, expectQ, formatCount, qOf, workspaceUrl } from "./_helpers"

/** The first cell of the cross-tabulation with the given sign of count, with its row and column elements. */
const findCell = (data: Crosstab, populated: boolean) => {
  const found = data.cells.find((c) => (c.count > 0) === populated)
  const row = data.rows.find((r) => r.value === found?.row)
  const col = data.cols.find((c) => c.value === found?.col)
  if (!found || !row || !col) throw new Error(`the cross-tabulation has no cell with ${populated ? "a count above 0" : "a count of 0"}`)
  return { cell: found, row, col }
}

/** The text of a cell colored by its ratio to the expected count. */
const ratioText = (ratio: number | null): string => {
  if (ratio === null) return ""
  if (ratio === 0) return "0×"
  if (ratio < 0.01) return "<0.01×"
  return `${ratio < 10 ? ratio.toPrecision(2) : formatCount(ratio)}×`
}

test.describe("heatmap", () => {
  test("a cell narrows the condition to the cell and stays, and selecting it again widens back to the table's population", async ({ page, request }) => {
    const assay = (await dataset(request)).targetAssays[0]
    if (!assay) throw new Error("the dataset has no target assay")
    const q = `library_strategy:${assay}`
    const data = await crosstab(request, "cell_line", "library_strategy", { q })
    const { cell: target, row, col } = findCell(data, true)
    const narrowed = await select(request, data.populationQ, [...row.clauses, ...col.clauses], "narrow")
    await page.goto(workspaceUrl({ tab: "heatmap", q }))
    await expect(cell(page, row.label, col.label)).toHaveText(formatCount(target.count))
    await expect(cellButton(page, row.label, col.label)).toHaveAttribute("aria-pressed", "false")
    await cellButton(page, row.label, col.label).click()
    await expectQ(page, narrowed)
    await expectParam(page, "tab", "heatmap")
    await expect(cellButton(page, row.label, col.label)).toHaveAttribute("aria-pressed", "true")
    await expect(cell(page, row.label, col.label)).toHaveText(formatCount(target.count))
    await cellButton(page, row.label, col.label).click()
    await expectQ(page, data.populationQ)
    await expect(cellButton(page, row.label, col.label)).toHaveAttribute("aria-pressed", "false")
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
    await cellButton(page, row.label, col.label).click()
    await expectQ(page, narrowed)
    expect(qOf(page)).not.toContain(" OR ")
    await expectParam(page, "unit", "sra-experiment")
    await expectParam(page, "tab", "heatmap")
  })

  test("a cell with a count of 0 is not a button", async ({ page, request }) => {
    const data = await crosstab(request, "disease", "tissue")
    const empty = findCell(data, false)
    const populated = findCell(data, true)
    await page.goto(workspaceUrl({ tab: "heatmap", row: "disease", col: "tissue" }))
    const target = cell(page, empty.row.label, empty.col.label)
    await expect(target).toBeVisible()
    await expect(target).toHaveText("0")
    await expect(cellButton(page, empty.row.label, empty.col.label)).toHaveCount(0)
    await expect(cell(page, populated.row.label, populated.col.label)).toHaveText(formatCount(populated.cell.count))
    await expect(cellButton(page, populated.row.label, populated.col.label)).toHaveCount(1)
  })

  test("picking a term in the axis dialog pins the axis in the URL and Reset to top 10 releases it", async ({ page, request }) => {
    const data = await crosstab(request, "cell_line", "library_strategy")
    const shown = data.rows.map((row) => row.value)
    const extra = (await terms(request, "cell_line", "")).find((term) => !shown.includes(term.termId))
    if (!extra) throw new Error("every listed cell line is already a row")
    await page.goto(workspaceUrl({ tab: "heatmap" }))
    await expect(axisTermsButton(page, "Rows")).toHaveText(`${shown.length} terms`)
    await axisTermsButton(page, "Rows").click()
    const dialog = axisTerms(page, "Rows")
    await expect(dialog.getByRole("button", { name: "Reset to top 10" })).toHaveCount(0)
    await dialog.getByRole("textbox", { name: "Search terms" }).fill(extra.termId)
    await dialog.getByRole("button").filter({ hasText: extra.termId }).click()
    await expectParam(page, "row_terms", [...shown, extra.termId].join(","))
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: `Remove ${extra.label ?? extra.termId}`, exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Reset to top 10" }).click()
    await expectParam(page, "row_terms", null)
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(axisTermsButton(page, "Rows")).toHaveText(`${shown.length} terms`)
  })

  test("Paste list starts with the terms of the axis, and replacing the axis with it keeps the terms and their order", async ({ page, request }) => {
    const data = await crosstab(request, "cell_line", "library_strategy")
    const shown = data.rows.map((row) => row.value)
    await page.goto(workspaceUrl({ tab: "heatmap" }))
    await axisTermsButton(page, "Rows").click()
    const dialog = axisTerms(page, "Rows")
    await dialog.getByRole("radio", { name: "Paste list" }).click()
    await expect(dialog.getByRole("textbox", { name: "Terms to set" })).toHaveValue(shown.join("\n"))
    await dialog.getByRole("button", { name: "Replace terms" }).click()
    await expectParam(page, "row_terms", shown.join(","))
    await expect(dialog.getByRole("button", { name: "Reset to top 10" })).toBeVisible()
  })

  test("the heading of a row term opens its child terms under it, a reload or the same URL in another page draws the same tree, and the heading closes it", async ({ page, request }) => {
    const data = await crosstab(request, "disease", "tissue")
    const shown = data.rows.map((row) => row.value)
    // A closed row whose children with matches are none of them rows yet, so that closing it gives the rows back as they were.
    let found: { parent: (typeof data.rows)[number]; children: string[] } | null = null
    for (const [index, parent] of data.rows.entries()) {
      if (!parent.hasChildren || data.rows[index + 1]?.parents.includes(parent.value)) continue
      const { children } = await get<{ children: { value: string }[] }>(request, "/api/terms/children", {
        field: "disease",
        termId: parent.value,
        q: data.populationQ,
        unit: "biosample",
        facetSelfExclude: true,
      })
      const values = children.map((child) => child.value)
      if (values.length > 0 && values.every((value) => !shown.includes(value))) {
        found = { parent, children: values }
        break
      }
    }
    if (!found) throw new Error("no closed disease row has child terms that are not rows already")
    const at = shown.indexOf(found.parent.value)
    const opened = [...shown.slice(0, at + 1), ...found.children, ...shown.slice(at + 1)].join(",")
    const headingIn = (target: typeof page) => target.getByRole("main").locator("tbody th").getByRole("button", { name: found.parent.label, exact: true })
    await page.goto(workspaceUrl({ tab: "heatmap", row: "disease", col: "tissue" }))
    await expect(headingIn(page)).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByRole("main").locator("thead th").getByRole("button")).toHaveCount(0)
    await headingIn(page).click()
    await expect(headingIn(page)).toHaveAttribute("aria-expanded", "true")
    await expectParam(page, "row_terms", opened)
    await page.reload()
    await expect(headingIn(page)).toHaveAttribute("aria-expanded", "true")
    const other = await page.context().newPage()
    await other.goto(page.url())
    await expect(headingIn(other)).toHaveAttribute("aria-expanded", "true")
    await other.close()
    await headingIn(page).click()
    await expect(headingIn(page)).toHaveAttribute("aria-expanded", "false")
    await expectParam(page, "row_terms", shown.join(","))
  })

  test("swapping the axes and choosing ratio colors are carried by the URL", async ({ page, request }) => {
    const data = await crosstab(request, "cell_line", "library_strategy")
    const { cell: target, row, col } = findCell(data, true)
    await page.goto(workspaceUrl({ tab: "heatmap" }))
    await page.getByRole("button", { name: "Swap axes" }).click()
    await expectParam(page, "row", "library_strategy")
    await expectParam(page, "col", "cell_line")
    await expectChosen(page.getByRole("combobox", { name: "Row dimension" }), "Assay")
    await expect(cell(page, col.label, row.label)).toHaveText(formatCount(target.count))
    await page.getByRole("radio", { name: "Ratio to expected" }).click()
    await expectParam(page, "color", "ratio")
    await expect(page.getByRole("main")).toContainText("≥ 4×")
    const swapped = await crosstab(request, "library_strategy", "cell_line")
    const same = swapped.cells.find((c) => c.row === col.value && c.col === row.value)
    if (!same) throw new Error("the swapped cross-tabulation lacks the cell")
    await expect(cell(page, col.label, row.label)).toHaveText(ratioText(same.ratio))
  })
})
