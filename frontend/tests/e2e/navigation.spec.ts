import { type APIRequestContext,expect, test } from "@playwright/test"

import { countOf, dataset, distribution, entries, entry, select, terms } from "./_api"
import { conditionPanel, conditionRegion, expectChosen, expectParam, expectQ, fieldLabel, formatCount, pageRangeText, qOf, TABLE_PER_PAGE, viewTabs, workspaceUrl } from "./_helpers"

/** The condition of the most frequent disease, with the term it names. */
const topDiseaseCondition = async (request: APIRequestContext) => {
  const [term] = (await distribution(request, "disease")).elements
  if (!term) throw new Error("the dataset has no disease")
  return { term, q: await select(request, null, term.clauses) }
}

const tabLabel = (tab: string | null): string => {
  const name = tab ?? "samples"
  return name.charAt(0).toUpperCase() + name.slice(1)
}

test.describe("workspace navigation", () => {
  test("switching tabs keeps the condition and the counting unit", async ({ page, request }) => {
    const { term, q } = await topDiseaseCondition(request)
    await page.goto(workspaceUrl({ q, tab: "distribution", unit: "bioproject" }))
    await viewTabs(page).getByRole("link", { name: "Heatmap" }).click()
    await expectParam(page, "tab", "heatmap")
    await expectQ(page, q)
    await expectParam(page, "unit", "bioproject")
    await expect(viewTabs(page).getByRole("link", { name: "Heatmap" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("radio", { name: "BioProjects" })).toHaveAttribute("aria-checked", "true")
    await viewTabs(page).getByRole("link", { name: "Samples" }).click()
    await expectParam(page, "tab", null)
    await expectQ(page, q)
    await expect(conditionRegion(page).getByTitle(term.value)).toContainText(term.label)
  })

  test("choosing Experiments writes the api value of the counting unit to the URL", async ({ page, request }) => {
    const { q } = await topDiseaseCondition(request)
    await page.goto(workspaceUrl({ tab: "distribution", q }))
    await page.getByRole("radio", { name: "SRA Experiments" }).click()
    await expectParam(page, "unit", "sra-experiment")
  })

  test("the header links to the API documentation served by the server", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^API/ })).toHaveAttribute("href", "/api")
  })

  test("a URL restores the condition, the unit, self-exclusion, and the status expansion", async ({ page, request }) => {
    const { term, q: termQ } = await topDiseaseCondition(request)
    const assay = (await dataset(request)).targetAssays[0]
    if (!assay) throw new Error("the dataset has no target assay")
    const q = await select(request, termQ, [{ field: "library_strategy", value: assay }])
    await page.goto(workspaceUrl({ q, tab: "distribution", unit: "bioproject", se: "0", states: "6" }))
    await expect(conditionRegion(page).getByTitle(term.value)).toContainText(term.label)
    await expect(conditionPanel(page).getByRole("checkbox", { name: new RegExp(assay) })).toBeChecked()
    await expect(viewTabs(page).getByRole("link", { name: "Distribution" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("radio", { name: "BioProjects" })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("switch")).not.toBeChecked()
    await expect(page.getByRole("main").getByRole("button", { name: "3 groups" }).first()).toBeVisible()
  })

  test("a URL restores the page of the entry list", async ({ page, request }) => {
    const { q } = await topDiseaseCondition(request)
    const total = (await entries(request, q, 1)).pagination.total
    const pages = Math.ceil(total / TABLE_PER_PAGE)
    expect(pages, "pages of the BioSample list").toBeGreaterThanOrEqual(3)
    await page.goto(workspaceUrl({ q, page: "2" }))
    await expect(page.getByRole("main").getByRole("columnheader", { name: "BioSample", exact: true })).toBeVisible()
    await expect(page.getByRole("main")).toContainText(pageRangeText(total, 2))
    await page.getByRole("button", { name: "Next page" }).first().click()
    await expectParam(page, "page", "3")
  })

  test("a row of the entry list opens the sample and the back link returns to the same state", async ({ page, request }) => {
    const { q } = await topDiseaseCondition(request)
    const [first] = (await entries(request, q)).items
    if (!first) throw new Error("the condition matches no BioSample")
    const detail = await entry(request, first.identifier)
    await page.goto(workspaceUrl({ q, unit: "bioproject" }))
    const row = page.getByRole("main").locator("tbody tr").first()
    await expect(row.locator("td").first()).toHaveText(first.identifier)
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/entries/${first.identifier}\\?from=`))
    await expect(page.getByText(first.identifier, { exact: true }).first()).toBeVisible()
    if (detail.title) await expect(page.getByText(detail.title, { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Original attributes")).toBeVisible()
    await expect(page.getByText("Annotations", { exact: true })).toBeVisible()
    if (detail.annotations.some((annotation) => annotation.evidence.length > 0)) await expect(page.locator("mark").first()).toBeVisible()
    await page.getByRole("link", { name: "Back to results" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/entries")
    await expectQ(page, q)
    await expectParam(page, "unit", "bioproject")
  })

  test("a term on the sample page searches for the samples annotated with it", async ({ page, request }) => {
    const { q } = await topDiseaseCondition(request)
    const [first] = (await entries(request, q)).items
    if (!first) throw new Error("the condition matches no BioSample")
    const annotated = (await entry(request, first.identifier)).annotations.find((annotation) => annotation.termId)
    if (!annotated?.termId) throw new Error("the sample has no annotated term")
    const expected = `${annotated.field}:"${annotated.termId}"`
    await page.goto(`/entries/${first.identifier}`)
    const link = page.locator(`a[href="/entries?${new URLSearchParams({ q: expected }).toString()}"]`).first()
    await link.click()
    await expect(page).toHaveURL((url) => url.pathname === "/entries")
    expect(qOf(page)).toBe(expected)
    await expect(conditionRegion(page).getByTitle(annotated.termId)).toContainText(annotated.label ?? annotated.termId)
  })

  test("a question on the landing page opens the workspace with its condition and view", async ({ page, request }) => {
    await page.goto("/")
    const link = page.locator("a[href^='/entries?']").first()
    const href = await link.getAttribute("href")
    const expected = new URL(href ?? "", page.url()).searchParams
    const q = expected.get("q")
    if (!q) throw new Error("the first example has no condition")
    await link.click()
    await expectQ(page, q)
    await expectParam(page, "tab", expected.get("tab"))
    await expectParam(page, "unit", expected.get("unit"))
    await expect(viewTabs(page).getByRole("link", { name: tabLabel(expected.get("tab")) })).toHaveAttribute("aria-current", "page")
    await expect(conditionRegion(page)).toContainText(new RegExp(`${formatCount(await countOf(request, q))}\\s+BioSamples`))
  })

  test("the landing search finds a term in every field and opens the workspace with it", async ({ page, request }) => {
    const [cellLine] = (await distribution(request, "cell_line")).elements
    if (!cellLine) throw new Error("the dataset has no cell line")
    const q = await select(request, null, cellLine.clauses)
    await page.goto("/")
    await page.getByRole("textbox", { name: /Search terms/ }).fill(cellLine.label)
    const hit = page.getByRole("button").filter({ hasText: cellLine.value })
    await expect(hit).toContainText(fieldLabel("cell_line"))
    await expect(hit).toContainText(cellLine.label)
    await hit.click()
    await expect(page).toHaveURL((url) => url.pathname === "/entries")
    await expectQ(page, q)
    await expect(conditionRegion(page).getByTitle(cellLine.value)).toContainText(cellLine.label)
  })

  test("a field on the landing page lists the terms of that field", async ({ page, request }) => {
    const [field] = (await dataset(request)).fields
    if (!field) throw new Error("the dataset has no annotation field")
    const label = fieldLabel(field.name)
    const [top] = await terms(request, field.name, "")
    if (!top) throw new Error(`the field ${field.name} has no term`)
    await page.goto("/")
    await page.getByRole("button", { name: `Browse ${label} terms` }).click()
    await expectChosen(page.getByRole("combobox", { name: "Field" }), label)
    await expect(page.getByRole("button").filter({ hasText: top.termId })).toContainText(top.label ?? top.termId)
    await page.getByRole("button", { name: "Clear search" }).click()
    await expectChosen(page.getByRole("combobox", { name: "Field" }), "All fields")
    await expect(page.getByRole("button", { name: `Browse ${label} terms` })).toBeVisible()
  })

  test("a bar of the landing statistics opens the workspace with its clause", async ({ page, request }) => {
    const [top] = (await distribution(request, "library_strategy", { limit: 3 })).elements
    if (!top) throw new Error("the dataset has no assay")
    const q = await select(request, null, top.clauses)
    await page.goto("/")
    const bar = page.getByRole("button").filter({ hasText: top.label })
    await expect(bar).toContainText(formatCount(top.count))
    await bar.click()
    await expect(page).toHaveURL((url) => url.pathname === "/entries")
    await expectQ(page, q)
  })

  test("an example heatmap on the landing page opens the heatmap with its axes", async ({ page }) => {
    await page.goto("/")
    const link = page.locator("a[href*='tab=heatmap']").first()
    const expected = new URL((await link.getAttribute("href")) ?? "", page.url()).searchParams
    const [row, col] = [expected.get("row"), expected.get("col")]
    if (!row || !col) throw new Error("the first example heatmap has no axes")
    await link.click()
    await expectParam(page, "tab", "heatmap")
    await expectParam(page, "row", row)
    await expectParam(page, "col", col)
    await expectParam(page, "unit", expected.get("unit"))
    await expectChosen(page.getByRole("combobox", { name: "Row dimension" }), fieldLabel(row))
    await expectChosen(page.getByRole("combobox", { name: "Column dimension" }), fieldLabel(col))
  })
})
