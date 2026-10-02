import { expect, type Page, test } from "@playwright/test"

import { countOf, dataset, distribution, entries } from "./_api"
import { addTermButton, choose, conditionPanel, conditionRegion, expectChosen, expectQ, formatCount, pageRangeText, termPicker, workspaceUrl } from "./_helpers"

/** The two most frequent disease terms and the first target assay of the dataset. */
const startingPoints = async (request: Parameters<typeof dataset>[0]) => {
  const [first, second] = (await distribution(request, "disease")).elements
  const assay = (await dataset(request)).targetAssays[0]
  if (!first || !second || !assay) throw new Error("the dataset has too few diseases or no target assay")
  return { first, second, assay }
}

/** The range of the last `years` years that the page computes, ending today in the browser's time zone. */
const lastYears = (page: Page, years: number): Promise<{ from: string; to: string }> =>
  page.evaluate((back) => {
    const pad = (value: number, width: number) => String(value).padStart(width, "0")
    const now = new Date()
    const day = (year: number, month: number, date: number) => `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(date, 2)}`
    const last = new Date(now.getFullYear() - back, now.getMonth() + 1, 0).getDate()
    return {
      from: day(now.getFullYear() - back, now.getMonth(), Math.min(now.getDate(), last)),
      to: day(now.getFullYear(), now.getMonth(), now.getDate()),
    }
  }, years)

test.describe("condition", () => {
  test("adding a term from the picker puts it in the URL, the condition bar, and the panel", async ({ page, request }) => {
    const { first } = await startingPoints(request)
    await page.goto("/entries")
    await addTermButton(page, "Disease").click()
    const picker = termPicker(page)
    await expect(picker).toBeVisible()
    await picker.getByRole("textbox", { name: "Search terms" }).fill(first.value)
    await picker.getByRole("button").filter({ hasText: first.value }).click()
    await expect(picker).toBeHidden()
    await expectQ(page, `disease:"${first.value}"`)
    await expect(conditionRegion(page).getByTitle(first.value)).toContainText(first.label)
    await expect(conditionPanel(page).getByTitle(first.value)).toContainText(first.label)
  })

  test("a term of the same field joins with OR and a different field with AND", async ({ page, request }) => {
    const { first, second, assay } = await startingPoints(request)
    await page.goto(workspaceUrl({ q: `disease:"${first.value}"` }))
    await conditionPanel(page).getByText(assay, { exact: true }).click()
    await expectQ(page, `disease:"${first.value}" AND library_strategy:${assay}`)
    await expect(conditionPanel(page).getByRole("checkbox", { name: new RegExp(assay) })).toBeChecked()
    await addTermButton(page, "Disease").click()
    await termPicker(page).getByRole("textbox", { name: "Search terms" }).fill(second.value)
    await termPicker(page).getByRole("button").filter({ hasText: second.value }).click()
    await expectQ(page, `(disease:"${first.value}" OR disease:"${second.value}") AND library_strategy:${assay}`)
    await expect(conditionRegion(page).getByText("AND", { exact: true })).toBeVisible()
    await expect(conditionRegion(page).getByText("OR", { exact: true })).toBeVisible()
  })

  test("removing a chip drops its clause and Clear all empties the condition", async ({ page, request }) => {
    const { first, assay } = await startingPoints(request)
    await page.goto(workspaceUrl({ q: `disease:"${first.value}" AND library_strategy:${assay}` }))
    await conditionRegion(page).getByTitle(first.value).getByRole("button", { name: "Remove" }).click()
    await expectQ(page, `library_strategy:${assay}`)
    await conditionRegion(page).getByRole("button", { name: "Clear all" }).click()
    await expectQ(page, null)
    await expect(conditionRegion(page)).toContainText("No condition")
  })

  test("the query editor applies a typed condition in its canonical form and reports a syntax error", async ({ page, request }) => {
    const { first, assay } = await startingPoints(request)
    const canonical = `disease:"${first.value}" AND library_strategy:${assay}`
    await page.goto("/entries")
    const region = conditionRegion(page)
    await region.getByRole("radio", { name: "Query" }).click()
    const editor = region.getByRole("textbox", { name: "Condition" })
    await editor.fill(`( disease:"${first.value}" )   AND library_strategy:${assay}`)
    await region.getByRole("button", { name: "Apply" }).click()
    await expectQ(page, canonical)
    await expect(editor).toHaveValue(canonical)
    await editor.fill("disease:")
    await region.getByRole("button", { name: "Apply" }).click()
    await expect(region).toContainText("unexpected token")
    await expectQ(page, canonical)
  })

  test("a creation-date range replaces the previous range instead of joining it", async ({ page, request }) => {
    await page.goto("/entries")
    const panel = conditionPanel(page)
    await panel.getByLabel("Created from").fill("2015-01-01")
    await panel.getByLabel("Created to").fill("2016-12-31")
    await expectQ(page, "date_created:[2015-01-01 TO 2016-12-31]")
    await expect(conditionRegion(page)).toContainText("2015–2016")
    await panel.getByRole("button", { name: "5 years" }).click()
    const { from, to } = await lastYears(page, 5)
    await expectQ(page, `date_created:[${from} TO ${to}]`)
    await expect(panel.getByRole("button", { name: "5 years" })).toHaveAttribute("aria-pressed", "true")
    await expect(conditionRegion(page)).toContainText(`${from} – ${to}`)
    const count = await countOf(request, `date_created:[${from} TO ${to}]`)
    await expect(page.getByRole("main")).toContainText(pageRangeText(count))
    await panel.getByRole("button", { name: "All", exact: true }).click()
    await expectQ(page, null)
  })

  test("the condition bar shows the count of each unit for the condition", async ({ page, request }) => {
    const { first } = await startingPoints(request)
    const q = `disease:"${first.value}"`
    await page.goto(workspaceUrl({ q }))
    for (const [unit, label] of [["biosample", "BioSamples"], ["sra-experiment", "SRA Experiments"], ["bioproject", "BioProjects"]] as const) {
      await expect(conditionRegion(page)).toContainText(new RegExp(`${formatCount(await countOf(request, q, unit))}\\s*${label}`))
    }
  })

  test("typed words and phrases become the keywords of the condition and one row of the condition bar", async ({ page, request }) => {
    await page.goto("/entries")
    const box = conditionPanel(page).getByRole("textbox", { name: "Keyword" })
    await box.fill("hypoxia")
    await box.press("Enter")
    await expectQ(page, "hypoxia")
    await expect(conditionRegion(page)).toContainText("Keyword")
    await expect(page.getByRole("main")).toContainText(pageRangeText(await countOf(request, "hypoxia")))
    await box.fill('"breast cancer" organoid')
    await expectQ(page, 'organoid AND "breast cancer"')
    await expect(conditionRegion(page).getByTitle('organoid "breast cancer"')).toBeVisible()
  })

  test("an accession typed as a keyword finds its entry", async ({ page, request }) => {
    const [item] = (await entries(request, "", 1)).items
    if (!item) throw new Error("the dataset has no BioSample")
    await page.goto("/entries")
    const box = conditionPanel(page).getByRole("textbox", { name: "Keyword" })
    await box.fill(item.identifier.toLowerCase())
    await box.press("Enter")
    await expectQ(page, item.identifier.toLowerCase())
    await expect(page.getByRole("main")).toContainText(pageRangeText(1))
  })

  test("a wildcard in the keyword box is reported and leaves the condition as it is", async ({ page }) => {
    await page.goto("/entries")
    const box = conditionPanel(page).getByRole("textbox", { name: "Keyword" })
    await box.fill("hepg*")
    await box.press("Enter")
    await expect(conditionPanel(page).getByRole("alert")).toContainText("wildcards")
    await expectQ(page, null)
  })

  test("the date inputs show the range of the condition and report a start after the end", async ({ page }) => {
    await page.goto(workspaceUrl({ q: "date_created:[2018-01-01 TO 2022-12-31]" }))
    const panel = conditionPanel(page)
    const from = panel.getByLabel("Created from")
    const to = panel.getByLabel("Created to")
    await expect(from).toHaveValue("2018-01-01")
    await expect(to).toHaveValue("2022-12-31")
    await expect(panel.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "false")
    await from.fill("2023-01-01")
    await expect(panel).toContainText("The start is after the end.")
    await expectQ(page, "date_created:[2018-01-01 TO 2022-12-31]")
    await from.fill("")
    await to.fill("")
    await expectQ(page, null)
  })

  test("the date inputs are empty and All is chosen without a date condition", async ({ page, request }) => {
    const { first } = await startingPoints(request)
    await page.goto(workspaceUrl({ q: `disease:"${first.value}"` }))
    const panel = conditionPanel(page)
    await expect(panel.getByLabel("Created from")).toHaveValue("")
    await expect(panel.getByLabel("Created to")).toHaveValue("")
    await expect(panel.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true")
  })

  test("the status buttons show the status condition of the field that has one", async ({ page }) => {
    await page.goto(workspaceUrl({ q: "tissue_status:no_value" }))
    const panel = conditionPanel(page)
    await expectChosen(panel.getByRole("combobox", { name: "Status field" }), "Tissue")
    await expect(panel.getByRole("button", { name: "No value" })).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByRole("button", { name: "Mapped", exact: true })).toHaveAttribute("aria-pressed", "false")
    await choose(panel.getByRole("combobox", { name: "Status field" }), "Disease")
    await expect(panel.getByRole("button", { name: "No value" })).toHaveAttribute("aria-pressed", "false")
    await panel.getByRole("button", { name: "Unmapped" }).click()
    await expectQ(page, "tissue_status:no_value AND disease_status:unmapped")
  })

  test("the keywords of the condition are shown in the box and removed from the condition bar", async ({ page, request }) => {
    const { first } = await startingPoints(request)
    const term = `disease:"${first.value}"`
    await page.goto(workspaceUrl({ q: `${term} AND hypoxia` }))
    const box = conditionPanel(page).getByRole("textbox", { name: "Keyword" })
    await expect(box).toHaveValue("hypoxia")
    await conditionRegion(page).getByTitle("hypoxia", { exact: true }).getByRole("button", { name: "Remove" }).click()
    await expectQ(page, term)
    await expect(box).toHaveValue("")
  })

  test("a negated clause and a disjunction over several fields are not shown as selections in the panel", async ({ page, request }) => {
    const [cellLine] = (await distribution(request, "cell_line")).elements
    const [tissue] = (await distribution(request, "tissue")).elements
    const assay = (await dataset(request)).targetAssays[0]
    if (!cellLine || !tissue || !assay) throw new Error("the dataset has no cell line, tissue, or target assay")
    await page.goto(workspaceUrl({ q: `NOT library_strategy:${assay} AND (cell_line:"${cellLine.value}" OR tissue:"${tissue.value}")` }))
    const panel = conditionPanel(page)
    await expect(conditionRegion(page)).toContainText(`NOT Assay: ${assay}`)
    await expect(conditionRegion(page)).toContainText(`Cell line: ${cellLine.label} OR Tissue: ${tissue.label}`)
    await expect(panel.getByRole("checkbox", { name: new RegExp(assay) })).not.toBeChecked()
    await expect(panel.getByTitle(cellLine.value)).toHaveCount(0)
    await expect(panel.getByTitle(tissue.value)).toHaveCount(0)
  })

  test("the picker searches every field and adds the chosen term under its own field", async ({ page, request }) => {
    const { first } = await startingPoints(request)
    await page.goto("/entries")
    await addTermButton(page, "Tissue").click()
    const picker = termPicker(page)
    await choose(picker.getByRole("combobox", { name: "Field", exact: true }), "All fields")
    await picker.getByRole("textbox", { name: "Search terms" }).fill(first.value)
    const hit = picker.getByRole("button").filter({ hasText: first.value })
    await expect(hit).toContainText("Disease")
    await hit.click()
    await expectQ(page, `disease:"${first.value}"`)
    await expect(conditionPanel(page).getByTitle(first.value)).toContainText(first.label)
  })
})
