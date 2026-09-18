import { expect, test } from "@playwright/test"

import { qOf, workspaceUrl } from "./helpers"

const BREAST_CANCER = "MONDO:0007254"

test.describe("trend", () => {
  test("with year rows in the heatmap, the trend plots an annotation field instead", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "trend", row: "date_created" }))
    await expect(page.getByRole("combobox", { name: "Series field" })).toHaveValue("cell_line")
    await expect(page.getByRole("main")).toContainText("Top terms (Cell line)")
    await expect(page.getByRole("main").locator("svg polyline").first()).toBeVisible()
  })

  test("the series follow the terms in the condition", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "trend", q: `disease:"${BREAST_CANCER}"` }))
    const main = page.getByRole("main")
    await expect(main).toContainText("Terms in the condition")
    await expect(main.locator("svg polyline")).toHaveCount(1)
    await expect(main.getByText(BREAST_CANCER, { exact: true })).toBeVisible()
  })

  test("clicking a point adds the term and its year to the condition", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "trend", q: `disease:"${BREAST_CANCER}"` }))
    await page.getByRole("main").locator("svg circle").first().click()
    await expect.poll(() => qOf(page)).toMatch(/^disease:"MONDO:0007254" AND date_created:\[\d{4}-01-01 TO \d{4}-12-31\]$/)
  })
})
