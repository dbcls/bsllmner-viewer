import { expect, test } from "@playwright/test"

import { workspaceUrl } from "./helpers"

const BREAST_CANCER = "MONDO:0007254"

test.describe("outputs of the condition", () => {
  test("the export menu links carry the condition", async ({ page }) => {
    await page.goto(workspaceUrl({ q: `disease:"${BREAST_CANCER}"` }))
    await page.getByRole("button", { name: "Export" }).click()
    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible()
    await expect(menu.getByRole("menuitem", { name: /Records · TSV/ })).toHaveAttribute("href", /^\/api\/export\/records\?q=disease.*&format=tsv$/)
    await expect(menu.getByRole("menuitem", { name: /BioProject/ })).toHaveAttribute("href", /^\/api\/export\/accessions\?q=disease.*&kind=bioproject$/)
    await page.keyboard.press("Escape")
    await expect(menu).toBeHidden()
  })

  test("the API modal shows the request for the current view and its response", async ({ page }) => {
    await page.goto(workspaceUrl({ q: `disease:"${BREAST_CANCER}"`, tab: "distribution", unit: "bioproject" }))
    await page.getByRole("button", { name: "API", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Same result via the API" })
    await expect(dialog).toContainText("/api/distribution?q=disease")
    await expect(dialog).toContainText("unit=bioproject")
    await expect(dialog).toContainText('"dataset_version"')
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  })

  test("Share copies the current URL", async ({ page }) => {
    // The dev server is reached by its container name, which is not a secure context, so the
    // clipboard is replaced by a recorder.
    await page.addInitScript(() => {
      const copied: string[] = []
      Object.defineProperty(window, "__copied", { value: copied })
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void copied.push(text) } })
    })
    await page.goto(workspaceUrl({ q: `disease:"${BREAST_CANCER}"` }))
    await page.getByRole("button", { name: "Share" }).click()
    await expect(page.getByRole("status")).toHaveText("Link copied")
    const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)
    expect(copied).toEqual([page.url()])
  })
})
