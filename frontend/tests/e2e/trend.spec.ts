import { expect, test } from "@playwright/test"

import { dataset, distribution, select, trend } from "./_api"
import { choose, expectChosen, expectParam, expectQ, formatCount, pageRangeText, viewTabs, workspaceUrl } from "./_helpers"

const topDisease = async (request: Parameters<typeof distribution>[0]) => {
  const [first] = (await distribution(request, "disease")).elements
  if (!first) throw new Error("the dataset has no disease")
  return first
}

test.describe("trend", () => {
  test("without a split, the trend draws only the line of the condition", async ({ page, request }) => {
    const disease = await topDisease(request)
    const q = await select(request, null, disease.clauses)
    const main = page.getByRole("main")
    await page.goto(workspaceUrl({ tab: "trend" }))
    await expectChosen(page.getByRole("combobox", { name: "Split by" }), "None")
    await expect(main.locator("svg polyline")).toHaveCount(1)
    await expect(main).toContainText("All entries")
    await page.goto(workspaceUrl({ tab: "trend", q }))
    const { total } = await trend(request, { q })
    await expect(main.locator("svg polyline")).toHaveCount(1)
    await expect(main).toContainText("Condition")
    await expect(main).not.toContainText("All entries")
    const points = main.locator('svg g[data-series="condition"] circle title')
    await expect(points).toHaveCount(total.length)
    for (const [index, point] of total.entries()) {
      await expect(points.nth(index)).toHaveText(`Condition · ${point.year}: ${formatCount(point.count)} BioSamples`)
    }
  })

  test("splitting by a field adds one line per element and records the field in the URL", async ({ page, request }) => {
    const disease = await topDisease(request)
    const q = await select(request, null, disease.clauses)
    const { series } = await trend(request, { field: "disease", q })
    expect(series.map((s) => s.value)).toContain(disease.value)
    await page.goto(workspaceUrl({ tab: "trend", q }))
    const main = page.getByRole("main")
    await choose(page.getByRole("combobox", { name: "Split by" }), "Disease")
    await expectParam(page, "trend_field", "disease")
    for (const s of series) {
      await expect(main.locator(`svg g[data-series="${s.value}"] polyline`)).toHaveCount(1)
      await expect(main.getByText(s.label, { exact: true })).toBeVisible()
    }
    await expect(main.locator("svg polyline")).toHaveCount(series.length + 1)
    await expect(main.getByText("Split lines are not filtered by Disease")).toBeVisible()
    await expect(main.getByText(disease.value, { exact: true })).toBeVisible()
    await expect(main).toContainText("✓ in condition")
    await choose(page.getByRole("combobox", { name: "Split by" }), "None")
    await expectParam(page, "trend_field", null)
    await expect(main.locator("svg polyline")).toHaveCount(1)
  })

  test("a point of the condition line toggles its year in the condition", async ({ page, request }) => {
    const disease = await topDisease(request)
    const q = await select(request, null, disease.clauses)
    const [firstYear] = (await trend(request, { q })).total
    if (!firstYear) throw new Error("the condition has no publication year")
    const withYear = await select(request, q, firstYear.clauses)
    await page.goto(workspaceUrl({ tab: "trend", q }))
    const point = page.getByRole("main").locator('svg g[data-series="condition"] circle').first()
    await point.click()
    await expectQ(page, withYear)
    await expect(page.getByRole("main").getByText("Not filtered by Year")).toBeVisible()
    await expectParam(page, "tab", "trend")
    await point.click()
    await expectQ(page, q)
  })

  test("a point of a split line opens the entry list narrowed to the element and the year", async ({ page, request }) => {
    const disease = await topDisease(request)
    const assay = (await dataset(request)).targetAssays[0]
    if (!assay) throw new Error("the dataset has no target assay")
    const q = await select(request, await select(request, null, disease.clauses), [{ field: "library_strategy", value: assay }])
    const data = await trend(request, { field: "library_strategy", q })
    const target = data.series
      .filter((s) => s.value !== assay)
      .flatMap((s) => s.points.filter((p) => p.count > 0).map((p) => ({ series: s, point: p })))[0]
    if (!target) throw new Error("no other assay matches the condition")
    const narrowed = await select(request, data.populationQ, target.point.clauses, "narrow")
    await page.goto(workspaceUrl({ tab: "trend", trend_field: "library_strategy", q }))
    const point = page
      .getByRole("main")
      .locator(`svg g[data-series="${target.series.value}"] circle.cursor-pointer`)
      .filter({ has: page.locator("title", { hasText: `· ${target.point.year}:` }) })
    // Circles of different lines can overlap on the plot, so the click is sent to this circle itself.
    await point.dispatchEvent("click")
    await expectQ(page, narrowed)
    await expectParam(page, "tab", null)
    await expect(viewTabs(page).getByRole("link", { name: "Samples" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("main")).toContainText(pageRangeText(target.point.count))
  })
})
