import { expect, test } from "@playwright/test"

import { distribution, select } from "./_api"
import { bar, expectQ, formatCount, workspaceUrl } from "./_helpers"

test.describe("distribution", () => {
  test("clicking a bar adds its clause and keeps the field's other bars under self-exclusion", async ({ page, request }) => {
    const [first] = (await distribution(request, "disease")).elements
    if (!first) throw new Error("the dataset has no disease")
    const q = await select(request, null, first.clauses)
    const after = await distribution(request, "disease", { q })
    const other = after.elements.find((element) => element.value !== first.value)
    if (!other) throw new Error("the distribution of disease has a single element")
    await page.goto(workspaceUrl({ tab: "distribution" }))
    await bar(page, first.label).click()
    await expectQ(page, q)
    await expect(bar(page, first.label)).toHaveAttribute("aria-pressed", "true")
    await expect(bar(page, first.label)).toContainText("in condition")
    await expect(bar(page, first.label)).toContainText(formatCount(after.elements.find((e) => e.value === first.value)?.count ?? first.count))
    await expect(page.getByRole("main").getByText("Not filtered by Disease")).toBeVisible()
    await expect(bar(page, other.label)).toBeVisible()
    await expect(bar(page, other.label)).toHaveAttribute("aria-pressed", "false")
    await expect(bar(page, other.label)).toContainText(formatCount(other.count))
  })

  test("clicking a selected bar removes its clause", async ({ page, request }) => {
    const [first] = (await distribution(request, "disease")).elements
    if (!first) throw new Error("the dataset has no disease")
    const q = await select(request, null, first.clauses)
    await page.goto(workspaceUrl({ tab: "distribution", q }))
    await expect(bar(page, first.label)).toHaveAttribute("aria-pressed", "true")
    await bar(page, first.label).click()
    await expectQ(page, null)
    await expect(bar(page, first.label)).toHaveAttribute("aria-pressed", "false")
  })

  test("a URL that turned self-exclusion off counts the field's own card with self-exclusion, and the view has no switch for it", async ({ page, request }) => {
    const [first] = (await distribution(request, "disease")).elements
    if (!first) throw new Error("the dataset has no disease")
    const q = await select(request, null, first.clauses)
    const on = await distribution(request, "disease", { q })
    const off = await distribution(request, "disease", { q, selfExclude: false })
    const gone = on.elements.filter((element) => !off.elements.some((e) => e.value === element.value))
    if (gone.length === 0) throw new Error("self-exclusion hides no element of the disease distribution")
    await page.goto(workspaceUrl({ tab: "distribution", q, se: "0" }))
    for (const element of gone) {
      await expect(bar(page, element.label)).toContainText(formatCount(element.count))
    }
    await expect(page.getByRole("switch")).toHaveCount(0)
  })

  test("the last row of a card counts the BioSamples of its population without a term of the field", async ({ page, request }) => {
    const disease = await distribution(request, "disease")
    if (disease.withoutTerm === null) throw new Error("the distribution of disease has no count without a term")
    const percent = `${Math.round((disease.withoutTerm / disease.total) * 100)}%`
    await page.goto(workspaceUrl({ tab: "distribution" }))
    const row = page.getByRole("main").getByText("No Disease term", { exact: true }).locator("..")
    await expect(row).toContainText(`${formatCount(disease.withoutTerm)} (${percent})`)
    await expect(page.getByRole("main").getByRole("button", { name: /No Disease term/ })).toHaveCount(0)
  })
})
