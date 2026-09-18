import { expect, test } from "@playwright/test"

import { bar, expectParam, expectQ, workspaceUrl } from "./helpers"

const CANCER = "MONDO:0004992"

test.describe("distribution", () => {
  test("clicking a bar adds its clause and keeps the field's other bars under self-exclusion", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "distribution" }))
    await bar(page, "cancer").click()
    await expectQ(page, `disease:"${CANCER}"`)
    await expect(bar(page, "cancer")).toHaveAttribute("aria-pressed", "true")
    await expect(bar(page, "cancer")).toContainText("in condition")
    await expect(page.getByRole("main").getByText("Not filtered by Disease")).toBeVisible()
    await expect(bar(page, "type 2 diabetes mellitus")).toBeVisible()
    await expect(bar(page, "type 2 diabetes mellitus")).toHaveAttribute("aria-pressed", "false")
  })

  test("clicking a selected bar removes its clause", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "distribution", q: `disease:"${CANCER}"` }))
    await expect(bar(page, "cancer")).toHaveAttribute("aria-pressed", "true")
    await bar(page, "cancer").click()
    await expectQ(page, null)
    await expect(bar(page, "cancer")).toHaveAttribute("aria-pressed", "false")
  })

  test("turning self-exclusion off restricts the field's own card to the condition", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "distribution", q: `disease:"${CANCER}"` }))
    await expect(bar(page, "type 2 diabetes mellitus")).toBeVisible()
    await page.getByText("Each view ignores its own filter").click()
    await expectParam(page, "se", "0")
    await expect(page.getByRole("switch")).not.toBeChecked()
    await expect(page.getByText("Each view applies its own filter")).toBeVisible()
    await expect(page.getByRole("main").getByText("Not filtered by Disease")).toHaveCount(0)
    await expect(bar(page, "cancer")).toBeVisible()
    await expect(bar(page, "type 2 diabetes mellitus")).toHaveCount(0)
  })

  test("the six statuses replace the three groups when expanded", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "distribution" }))
    const main = page.getByRole("main")
    await expect(main.getByText(/^Mapped /).first()).toBeVisible()
    await expect(main.getByText(/^LLM selected /)).toHaveCount(0)
    await main.getByRole("button", { name: "6 states" }).first().click()
    await expectParam(page, "states", "6")
    await expect(main.getByText(/^LLM selected /).first()).toBeVisible()
    await expect(main.getByText(/^Extraction failed /).first()).toBeVisible()
    await main.getByRole("button", { name: "3 groups" }).first().click()
    await expectParam(page, "states", null)
    await expect(main.getByText(/^LLM selected /)).toHaveCount(0)
  })

  test("a bar with child terms expands them below it and records the expansion in the URL", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "distribution" }))
    const main = page.getByRole("main")
    await expect(main.getByText("lung adenocarcinoma", { exact: true })).toHaveCount(1)
    await bar(page, "cancer").getByRole("button", { name: "Expand child terms" }).click()
    await expectParam(page, "expand", `disease:${CANCER}`)
    await expect(main.getByText("lung adenocarcinoma", { exact: true })).toHaveCount(2)
    await bar(page, "cancer").getByRole("button", { name: "Collapse child terms" }).click()
    await expectParam(page, "expand", null)
    await expect(main.getByText("lung adenocarcinoma", { exact: true })).toHaveCount(1)
  })
})
