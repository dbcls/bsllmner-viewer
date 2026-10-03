import { expect, type Page, test } from "@playwright/test"

import { dataset, distribution, select, terms, trend } from "./_api"
import { axisTermsButton, choose, expectChosen, expectParam, expectQ, formatCount, workspaceUrl } from "./_helpers"

/**
 * Flips a switch as a person does, by its label. The checkbox of a switch is hidden inside the label, so a click on the
 * checkbox itself never lands.
 */
const flip = async (page: Page, name: string): Promise<void> => {
  await page.locator("label").filter({ has: page.getByRole("switch", { name, exact: true }) }).click()
}

const topDisease = async (request: Parameters<typeof distribution>[0]) => {
  const [first] = (await distribution(request, "disease")).elements
  if (!first) throw new Error("the dataset has no disease")
  return first
}

test.describe("trend", () => {
  test("the trend draws one line per disease by default, and the line of the condition only when there is a condition", async ({ page, request }) => {
    const disease = await topDisease(request)
    const q = await select(request, null, disease.clauses)
    const main = page.getByRole("main")
    const whole = await trend(request, { field: "disease" })
    await page.goto(workspaceUrl({ tab: "trend" }))
    await expectChosen(page.getByRole("combobox", { name: "Line dimension" }), "Disease")
    await expect(axisTermsButton(page, "Lines")).toHaveText(`${whole.series.length} terms`)
    await expect(main.locator("svg polyline")).toHaveCount(whole.series.length)
    await expect(page.getByRole("switch", { name: "Condition" })).toBeDisabled()
    await expect(page.getByRole("switch", { name: "All entries" })).not.toBeChecked()
    await page.goto(workspaceUrl({ tab: "trend", q }))
    const { total, series } = await trend(request, { field: "disease", q })
    expect(series.map((s) => s.value)).toContain(disease.value)
    await expect(main.locator("svg polyline")).toHaveCount(series.length + 1)
    await expect(page.getByRole("switch", { name: "Condition" })).toBeChecked()
    // The legend names the lines by their terms; their IDs appear only with the Term IDs switch on.
    await expect(main.getByText(disease.label, { exact: true })).toBeVisible()
    await expect(main).toContainText("✓ in condition")
    const points = main.locator('svg g[data-series="condition"] circle')
    await expect(points).toHaveCount(total.length)
    for (const [index, point] of total.entries()) {
      await expect(points.nth(index)).toHaveAttribute("aria-label", `Condition, ${point.year}: ${formatCount(point.count)} BioSamples. Toggle this year in the condition`)
    }
  })

  test("choosing another dimension for the lines draws its elements and records the dimension in the URL", async ({ page, request }) => {
    const { series } = await trend(request, { field: "library_strategy" })
    await page.goto(workspaceUrl({ tab: "trend" }))
    const main = page.getByRole("main")
    await choose(page.getByRole("combobox", { name: "Line dimension" }), "Assay")
    await expectParam(page, "trend_field", "library_strategy")
    for (const s of series) {
      await expect(main.locator(`svg g[data-series="${s.value}"] polyline`)).toHaveCount(1)
      await expect(main.getByText(s.label, { exact: true })).toBeVisible()
    }
    await expect(main.locator("svg polyline")).toHaveCount(series.length)
    await expect(axisTermsButton(page, "Lines")).toHaveText(`${series.length} terms`)
    await choose(page.getByRole("combobox", { name: "Line dimension" }), "Disease")
    await expectParam(page, "trend_field", null)
  })

  test("hiding the line of the condition keeps the lines of the elements and records it in the URL", async ({ page, request }) => {
    const disease = await topDisease(request)
    const q = await select(request, null, disease.clauses)
    const { series } = await trend(request, { field: "disease", q })
    await page.goto(workspaceUrl({ tab: "trend", q }))
    const main = page.getByRole("main")
    await expect(main.locator("svg polyline")).toHaveCount(series.length + 1)
    await flip(page, "Condition")
    await expectParam(page, "trend_condition", "off")
    await expect(main.locator('svg g[data-series="condition"]')).toHaveCount(0)
    await expect(main.locator("svg polyline")).toHaveCount(series.length)
    await flip(page, "Condition")
    await expectParam(page, "trend_condition", null)
    await expect(main.locator("svg polyline")).toHaveCount(series.length + 1)
  })

  test("All entries draws the whole dataset in the years of the condition next to it, and its points add their year to the condition like the points of the Condition line", async ({ page, request }) => {
    const disease = await topDisease(request)
    const q = await select(request, null, disease.clauses)
    const { allEntries, total } = await trend(request, { field: "disease", q })
    const whole = new Map((await trend(request, {})).total.map((point) => [point.year, point.count]))
    expect(allEntries.map((point) => point.count)).toEqual(allEntries.map((point) => whole.get(point.year) ?? 0))
    await page.goto(workspaceUrl({ tab: "trend", q }))
    const main = page.getByRole("main")
    await expect(main.locator('svg g[data-series="all"]')).toHaveCount(0)
    await flip(page, "All entries")
    await expectParam(page, "trend_all", "on")
    const points = main.locator('svg g[data-series="all"] circle')
    await expect(points).toHaveCount(allEntries.length)
    for (const [index, point] of allEntries.entries()) {
      await expect(points.nth(index)).toHaveAttribute("aria-label", new RegExp(`^All entries, ${point.year}: ${formatCount(point.count)} BioSamples\\.`))
    }
    await expect(main.locator('svg g[data-series="condition"] circle')).toHaveCount(total.length)
    const first = allEntries[0]
    if (!first) throw new Error("the trend has no year")
    const widened = await select(request, q, first.clauses)
    await points.first().dispatchEvent("click")
    await expectQ(page, widened)
  })

  test("the years limit the points to the chosen range as the api returns them, and the first and last years take the limit off", async ({ page, request }) => {
    const disease = await topDisease(request)
    const q = await select(request, null, disease.clauses)
    // The trend always draws the lines of a field, whose population widens the span of years.
    const whole = await trend(request, { field: "disease", q })
    if (whole.years.length < 3) throw new Error("the condition matches fewer than three years")
    const from = whole.years[1] as number
    const to = whole.years[whole.years.length - 2] as number
    const limited = await trend(request, { field: "disease", q, yearFrom: from, yearTo: to })
    await page.goto(workspaceUrl({ tab: "trend", q }))
    const points = page.getByRole("main").locator('svg g[data-series="condition"] circle')
    await expect(points).toHaveCount(whole.total.length)
    await choose(page.getByRole("combobox", { name: "First year" }), String(from))
    await expectParam(page, "trend_from", String(from))
    await choose(page.getByRole("combobox", { name: "Last year" }), String(to))
    await expectParam(page, "trend_to", String(to))
    await expect(points).toHaveCount(limited.total.length)
    for (const [index, point] of limited.total.entries()) {
      await expect(points.nth(index)).toHaveAttribute("aria-label", new RegExp(`^Condition, ${point.year}: ${formatCount(point.count)} BioSamples\\.`))
    }
    await choose(page.getByRole("combobox", { name: "First year" }), String(whole.firstYear))
    await expectParam(page, "trend_from", null)
    await choose(page.getByRole("combobox", { name: "Last year" }), String(whole.lastYear))
    await expectParam(page, "trend_to", null)
    await expect(points).toHaveCount(whole.total.length)
  })

  test("data labels write the count above every point that has a count", async ({ page, request }) => {
    const disease = await topDisease(request)
    const q = await select(request, null, disease.clauses)
    const { total, series } = await trend(request, { field: "disease", q })
    await page.goto(workspaceUrl({ tab: "trend", q }))
    const labels = page.getByRole("main").locator("svg g[data-labels] text")
    await expect(labels).toHaveCount(0)
    await flip(page, "Data labels")
    await expectParam(page, "trend_labels", "on")
    // The labels of the lines of the elements come first, and those of the line of the condition, drawn over them, last.
    const counted = [...series.flatMap((s) => s.points), ...total].filter((point) => point.count > 0)
    await expect(labels).toHaveText(counted.map((point) => formatCount(point.count)))
  })

  test("the terms dialog refuses a sixth line, and taking a term off makes room for another", async ({ page, request }) => {
    const { series } = await trend(request, { field: "disease" })
    const shown = series.map((s) => s.value)
    if (shown.length < 5) throw new Error("the dataset has fewer than five diseases")
    const extra = (await terms(request, "disease", "")).find((term) => !shown.includes(term.termId))
    if (!extra) throw new Error("every listed disease is already a line")
    await page.goto(workspaceUrl({ tab: "trend" }))
    await axisTermsButton(page, "Lines").click()
    const dialog = page.getByRole("dialog", { name: "Line terms" })
    await dialog.getByRole("textbox", { name: "Search terms" }).fill(extra.termId)
    await dialog.getByRole("button").filter({ hasText: extra.termId }).click()
    await expect(page.getByText("A trend shows up to 5 terms")).toBeVisible()
    await expectParam(page, "trend_terms", null)
    await dialog.getByRole("button", { name: `Remove ${series[0]?.label ?? ""}`, exact: true }).click()
    await expectParam(page, "trend_terms", shown.slice(1).join(","))
    await dialog.getByRole("button").filter({ hasText: extra.termId }).click()
    await expectParam(page, "trend_terms", [...shown.slice(1), extra.termId].join(","))
    const chosen = await trend(request, { field: "disease", elements: [...shown.slice(1), extra.termId] })
    await page.keyboard.press("Escape")
    await expect(page.getByRole("main").locator("svg polyline")).toHaveCount(chosen.series.length)
  })

  test("a point of the condition line toggles its year in the condition", async ({ page, request }) => {
    const disease = await topDisease(request)
    const q = await select(request, null, disease.clauses)
    const [firstYear] = (await trend(request, { field: "disease", q })).total
    if (!firstYear) throw new Error("the condition has no publication year")
    const withYear = await select(request, q, firstYear.clauses)
    await page.goto(workspaceUrl({ tab: "trend", q }))
    const point = page.getByRole("main").locator('svg g[data-series="condition"] circle').first()
    await point.click()
    await expectQ(page, withYear)
    await expectParam(page, "tab", "trend")
    await expect(point).toHaveAttribute("aria-pressed", "true")
    await point.click()
    await expectQ(page, q)
  })

  test("a point of a split line narrows the condition to the element and the year and stays, and selecting it again widens back", async ({ page, request }) => {
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
    const point = page.getByRole("main").locator(`svg g[data-series="${target.series.value}"] circle[role="button"][aria-label*=", ${target.point.year}: "]`)
    await expect(point).toHaveAttribute("aria-pressed", "false")
    // Circles of different lines can overlap on the plot, so the click is sent to this circle itself.
    await point.dispatchEvent("click")
    await expectQ(page, narrowed)
    await expectParam(page, "tab", "trend")
    await expect(point).toHaveAttribute("aria-pressed", "true")
    // A point of the trend of the previous condition does not respond until the trend of the new condition is drawn.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    await point.dispatchEvent("click")
    await expectQ(page, data.populationQ)
    await expect(point).toHaveAttribute("aria-pressed", "false")
  })
})
