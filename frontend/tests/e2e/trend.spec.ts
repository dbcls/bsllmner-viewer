import { expect, test } from "@playwright/test"

import { choose, expectChosen, expectParam, expectQ, qOf, viewTabs, workspaceUrl } from "./helpers"

const BREAST_CANCER = "MONDO:0007254"

test.describe("trend", () => {
  test("without a split, the trend draws only the line of the condition", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "trend" }))
    const main = page.getByRole("main")
    await expectChosen(page.getByRole("combobox", { name: "Split by" }), "None")
    await expect(main.locator("svg polyline")).toHaveCount(1)
    await expect(main).toContainText("All records")
    await page.goto(workspaceUrl({ tab: "trend", q: `disease:"${BREAST_CANCER}"` }))
    await expect(main.locator("svg polyline")).toHaveCount(1)
    await expect(main).toContainText("Condition")
    await expect(main).not.toContainText("All records")
  })

  test("splitting by a field adds one line per element and records the field in the URL", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "trend", q: `disease:"${BREAST_CANCER}"` }))
    const main = page.getByRole("main")
    await choose(page.getByRole("combobox", { name: "Split by" }), "Disease")
    await expectParam(page, "trend_field", "disease")
    await expect(main.locator(`svg g[data-series="${BREAST_CANCER}"] polyline`)).toHaveCount(1)
    await expect(main.locator("svg polyline").nth(1)).toBeVisible()
    await expect(main.getByText("Split lines are not filtered by Disease")).toBeVisible()
    await expect(main.getByText(BREAST_CANCER, { exact: true })).toBeVisible()
    await expect(main).toContainText("✓ in condition")
    await choose(page.getByRole("combobox", { name: "Split by" }), "None")
    await expectParam(page, "trend_field", null)
    await expect(main.locator("svg polyline")).toHaveCount(1)
  })

  test("a point of the condition line toggles its year in the condition", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "trend", q: `disease:"${BREAST_CANCER}"` }))
    const point = page.getByRole("main").locator('svg g[data-series="condition"] circle').first()
    await point.click()
    await expect.poll(() => qOf(page)).toMatch(/^disease:"MONDO:0007254" AND date_created:\[\d{4}-01-01 TO \d{4}-12-31\]$/)
    await expect(page.getByRole("main").getByText("Not filtered by Year")).toBeVisible()
    await expectParam(page, "tab", "trend")
    await point.click()
    await expectQ(page, `disease:"${BREAST_CANCER}"`)
  })

  test("a point of a split line opens the record list narrowed to the element and the year", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "trend", trend_field: "library_strategy", q: `disease:"${BREAST_CANCER}" AND library_strategy:ATAC-seq` }))
    const point = page.getByRole("main").locator('svg g[data-series="RNA-Seq"] circle.cursor-pointer').first()
    const title = await point.locator("title").textContent()
    const [, year, count] = /· (\d{4}): ([\d,]+) /.exec(title ?? "") ?? []
    await point.click({ force: true })
    await expectQ(page, `disease:"${BREAST_CANCER}" AND library_strategy:RNA-Seq AND date_created:[${year}-01-01 TO ${year}-12-31]`)
    await expectParam(page, "tab", null)
    await expect(viewTabs(page).getByRole("link", { name: "Samples" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("main")).toContainText(`${count} BioSamples match`)
  })
})
