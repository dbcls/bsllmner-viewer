import { expect, test } from "@playwright/test"

import { conditionPanel, conditionRegion, expectParam, expectQ, qOf, viewTabs, workspaceUrl } from "./helpers"

const BREAST_CANCER = "MONDO:0007254"

test.describe("workspace navigation", () => {
  test("switching tabs keeps the condition and the counting unit", async ({ page }) => {
    await page.goto(workspaceUrl({ q: `disease:"${BREAST_CANCER}"`, tab: "distribution", unit: "bioproject" }))
    await viewTabs(page).getByRole("link", { name: "Heatmap" }).click()
    await expectParam(page, "tab", "heatmap")
    await expectQ(page, `disease:"${BREAST_CANCER}"`)
    await expectParam(page, "unit", "bioproject")
    await expect(viewTabs(page).getByRole("link", { name: "Heatmap" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("radio", { name: "BioProjects" })).toHaveAttribute("aria-checked", "true")
    await viewTabs(page).getByRole("link", { name: "Samples" }).click()
    await expectParam(page, "tab", null)
    await expectQ(page, `disease:"${BREAST_CANCER}"`)
    await expect(conditionRegion(page).getByTitle(BREAST_CANCER)).toContainText("breast cancer")
  })

  test("a URL restores the condition, the unit, self-exclusion, and the status expansion", async ({ page }) => {
    await page.goto(
      workspaceUrl({ q: `disease:"${BREAST_CANCER}" AND library_strategy:ATAC-seq`, tab: "distribution", unit: "bioproject", se: "0", states: "6" }),
    )
    await expect(conditionRegion(page).getByTitle(BREAST_CANCER)).toContainText("breast cancer")
    await expect(conditionPanel(page).getByRole("checkbox", { name: /ATAC-seq/ })).toBeChecked()
    await expect(viewTabs(page).getByRole("link", { name: "Distribution" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("radio", { name: "BioProjects" })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("switch")).not.toBeChecked()
    await expect(page.getByRole("main").getByRole("button", { name: "3 groups" }).first()).toBeVisible()
  })

  test("a URL restores the record unit and the page of the record list", async ({ page }) => {
    await page.goto(workspaceUrl({ rows: "experiment", page: "2" }))
    await expect(page.getByRole("radio", { name: "Experiments" })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("main").getByRole("columnheader", { name: "Experiment", exact: true })).toBeVisible()
    await expect(page.getByRole("main")).toContainText("Page 2 of")
    await page.getByRole("button", { name: "Next page" }).click()
    await expectParam(page, "page", "3")
    await page.getByRole("radio", { name: "BioSamples" }).click()
    await expectParam(page, "rows", null)
    await expectParam(page, "page", null)
  })

  test("a row of the record list opens the sample and the back link returns to the same state", async ({ page }) => {
    await page.goto(workspaceUrl({ q: `disease:"${BREAST_CANCER}"`, unit: "bioproject" }))
    const first = page.getByRole("main").locator("tbody tr").first()
    const accession = (await first.locator("td").first().innerText()).trim()
    await first.click()
    await expect(page).toHaveURL(new RegExp(`/s/${accession}\\?from=`))
    await expect(page.getByText(accession, { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Original attributes")).toBeVisible()
    await expect(page.getByText("Annotations", { exact: true })).toBeVisible()
    await page.getByRole("link", { name: "Back to results" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/w")
    await expectQ(page, `disease:"${BREAST_CANCER}"`)
    await expectParam(page, "unit", "bioproject")
  })

  test("a term on the sample page searches for the samples annotated with it", async ({ page }) => {
    await page.goto(workspaceUrl({ q: `disease:"${BREAST_CANCER}"` }))
    await page.getByRole("main").locator("tbody tr").first().click()
    await expect(page).toHaveURL(/\/s\//)
    // The sample matched the condition by breast cancer or one of its descendants; its own term is linked.
    const link = page.locator("a[href^='/w?q=disease']").filter({ hasNotText: "Back to results" }).first()
    const label = (await link.innerText()).trim()
    const q = new URL(await link.evaluate((a: HTMLAnchorElement) => a.href)).searchParams.get("q")
    expect(q).toMatch(/^disease:"MONDO:\d+"$/)
    await link.click()
    await expect(page).toHaveURL((url) => url.pathname === "/w")
    expect(qOf(page)).toBe(q)
    await expect(conditionRegion(page)).toContainText(label)
  })

  test("a question on the landing page opens the workspace with its condition and view", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("link", { name: /ATAC-seq data for breast cancer/ }).click()
    await expectQ(page, `disease:"${BREAST_CANCER}" AND library_strategy:ATAC-seq`)
    await expectParam(page, "tab", "projects")
    await expectParam(page, "unit", "bioproject")
    await expect(viewTabs(page).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("main").locator("tbody tr").first()).toBeVisible()
  })

  test("the landing search finds a term in every field and opens the workspace with it", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("textbox", { name: /Search terms/ }).fill("K562")
    const hit = page.getByRole("button").filter({ hasText: "CVCL:0004" })
    await expect(hit).toContainText("Cell line")
    await expect(hit).toContainText("K-562")
    await hit.click()
    await expect(page).toHaveURL((url) => url.pathname === "/w")
    await expectQ(page, 'cell_line:"CVCL:0004"')
    await expect(conditionRegion(page).getByTitle("CVCL:0004")).toContainText("K-562")
  })

  test("a field on the landing page lists the terms of that field", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Browse Tissue terms" }).click()
    await expect(page.getByRole("combobox", { name: "Field" })).toHaveValue("tissue")
    const hit = page.getByRole("button").filter({ hasText: "UBERON:0002107" })
    await expect(hit).toContainText("liver")
    await page.getByRole("button", { name: "Clear search" }).click()
    await expect(page.getByRole("combobox", { name: "Field" })).toHaveValue("*")
    await expect(page.getByRole("button", { name: "Browse Tissue terms" })).toBeVisible()
  })

  test("a bar of the landing statistics opens the workspace with its clause", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button").filter({ hasText: "ATAC-seq" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/w")
    await expectQ(page, "library_strategy:ATAC-seq")
  })

  test("an example heatmap on the landing page opens the heatmap with its axes", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("link", { name: "Disease × Tissue" }).click()
    await expectParam(page, "tab", "heatmap")
    await expectParam(page, "row", "disease")
    await expectParam(page, "col", "tissue")
    await expectParam(page, "unit", "bioproject")
    await expect(page.getByRole("combobox", { name: "Row dimension" })).toHaveValue("disease")
    await expect(page.getByRole("combobox", { name: "Column dimension" })).toHaveValue("tissue")
  })
})
