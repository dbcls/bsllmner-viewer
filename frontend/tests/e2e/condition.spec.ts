import { expect, type Page, test } from "@playwright/test"

import { countOf, countsOfElements, dataset, distribution, entries, listedOrganisms, parse, select, termSearch, trend } from "./_api"
import { addTermButton, choose, conditionPanel, conditionRegion, expectChosen, expectQ, fieldLabel, formatCount, pageRangeText, skipUnless, termPicker, workspaceUrl } from "./_helpers"

/** The two most frequent disease terms and the first target assay of the dataset. */
const startingPoints = async (request: Parameters<typeof dataset>[0]) => {
  const [first, second] = (await distribution(request, "disease")).elements
  const assay = (await dataset(request)).targetAssays[0]
  if (!first || !assay) throw new Error("the dataset has no disease or no target assay")
  return { first, second, assay }
}

/**
 * A word of a frequent disease label that some BioSample matches as a keyword. The word is not one of the given labels,
 * so that the chip of the keyword and the chip of a term have different names.
 */
const aKeyword = async (request: Parameters<typeof dataset>[0], labels: string[] = []): Promise<string> => {
  const taken = new Set(labels.map((label) => label.toLowerCase()))
  for (const element of (await distribution(request, "disease")).elements) {
    for (const word of element.label.split(/\s+/)) {
      if (!/^[A-Za-z0-9]{4,}$/.test(word) || /^(and|or|not)$/i.test(word) || taken.has(word.toLowerCase())) continue
      if ((await countOf(request, word)) > 0) return word
    }
  }
  throw new Error("no word of the disease labels matches a BioSample as a keyword")
}

/** The status fields that the status scenario uses: the first two annotation fields of the dataset. */
const statusFields = async (request: Parameters<typeof dataset>[0]) => {
  const [first, second] = (await dataset(request)).fields
  if (!first) throw new Error("the dataset has no annotation field")
  skipUnless(second, "the dataset has a single annotation field")
  return { first: first.name, second: second.name }
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
    await addTermButton(page).click()
    const picker = termPicker(page)
    await expect(picker).toBeVisible()
    await picker.getByRole("textbox", { name: "Search terms" }).fill(first.value)
    await picker.getByRole("button").filter({ hasText: first.value }).click()
    await expect(picker).toBeHidden()
    await expectQ(page, `disease:"${first.value}"`)
    await expect(conditionRegion(page).getByRole("button", { name: `Remove ${first.label}`, exact: true })).toBeVisible()
    await expect(conditionRegion(page).getByText(first.value, { exact: true })).toBeVisible()
    await expect(conditionPanel(page).getByRole("button", { name: `Remove Disease: ${first.label}` })).toBeVisible()
  })

  test("a term of the same field joins with OR and a different field with AND", async ({ page, request }) => {
    const { first, second, assay } = await startingPoints(request)
    skipUnless(second, "the dataset has a single disease")
    await page.goto(workspaceUrl({ q: `disease:"${first.value}"` }))
    await conditionPanel(page).getByText(assay, { exact: true }).click()
    await expectQ(page, `disease:"${first.value}" AND library_strategy:${assay}`)
    await expect(conditionPanel(page).getByRole("checkbox", { name: new RegExp(assay) })).toBeChecked()
    await addTermButton(page).click()
    await termPicker(page).getByRole("textbox", { name: "Search terms" }).fill(second.value)
    await termPicker(page).getByRole("button").filter({ hasText: second.value }).click()
    await expectQ(page, `(disease:"${first.value}" OR disease:"${second.value}") AND library_strategy:${assay}`)
    await expect(conditionRegion(page).getByText("AND", { exact: true })).toBeVisible()
    await expect(conditionRegion(page).getByText("OR", { exact: true })).toBeVisible()
  })

  test("removing a chip drops its clause and Clear all empties the condition", async ({ page, request }) => {
    const { first, assay } = await startingPoints(request)
    await page.goto(workspaceUrl({ q: `disease:"${first.value}" AND library_strategy:${assay}` }))
    await conditionRegion(page).getByRole("button", { name: `Remove ${first.label}`, exact: true }).click()
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

  test("a publication-date range replaces the previous range instead of joining it", async ({ page, request }) => {
    await page.goto("/entries")
    const panel = conditionPanel(page)
    await panel.getByLabel("Published from").fill("2015-01-01")
    await panel.getByLabel("Published to").fill("2016-12-31")
    await expectQ(page, "date_published:[2015-01-01 TO 2016-12-31]")
    await expect(conditionRegion(page)).toContainText("2015–2016")
    await panel.getByRole("button", { name: "5 years" }).click()
    const { from, to } = await lastYears(page, 5)
    await expectQ(page, `date_published:[${from} TO ${to}]`)
    await expect(panel.getByRole("button", { name: "5 years" })).toHaveAttribute("aria-pressed", "true")
    await expect(conditionRegion(page)).toContainText(`${from} – ${to}`)
    const count = await countOf(request, `date_published:[${from} TO ${to}]`)
    await expect(page.getByRole("main")).toContainText(pageRangeText(count))
    await panel.getByRole("button", { name: "All", exact: true }).click()
    await expectQ(page, null)
  })

  test("the condition bar shows the count of each unit for a condition on each kind of field", async ({ page, request }) => {
    const { first, assay } = await startingPoints(request)
    const [organism] = listedOrganisms(await dataset(request))
    const { firstYear } = await trend(request)
    if (!organism || firstYear === null) throw new Error("the dataset has no organism or no publication year")
    const keyword = (await parse(request, await aKeyword(request))).q
    if (!keyword) throw new Error("the keyword has no canonical form")
    const conditions = [
      await select(request, null, first.clauses),
      await select(request, null, [{ field: "organism_id", value: organism.identifier }]),
      await select(request, null, [{ field: "library_strategy", value: assay }]),
      await select(request, null, [{ field: "date_published", from: `${firstYear}-01-01`, to: `${firstYear}-12-31` }]),
      keyword,
    ]
    for (const q of conditions) {
      await page.goto(workspaceUrl({ q }))
      for (const [unit, label] of [["biosample", "BioSamples"], ["sra-experiment", "SRA Experiments"], ["bioproject", "BioProjects"]] as const) {
        // The lookbehind keeps a count from matching the end of a longer number.
        await expect(conditionRegion(page), `${label} of ${q}`).toContainText(new RegExp(`(?<![\\d,])${formatCount(await countOf(request, q, unit))}\\s*${label}`))
      }
    }
  })

  test("the assay and organism counts of the condition panel are counted without the condition on their own field", async ({ page, request }) => {
    const data = await dataset(request)
    const [organism, otherOrganism] = listedOrganisms(data)
    const [assay, otherAssay] = data.targetAssays
    skipUnless(organism && otherOrganism && assay && otherAssay, "the dataset has fewer than two listed organisms or two target assays")
    const q = await select(request, await select(request, null, [{ field: "organism_id", value: organism.identifier }]), [{ field: "library_strategy", value: assay }])
    const assayCount = (await countsOfElements(request, "library_strategy", [otherAssay], q, true)).get(otherAssay) ?? 0
    const organismCount = (await countsOfElements(request, "organism_id", [otherOrganism.identifier], q, true)).get(otherOrganism.identifier) ?? 0
    // Only a count that differs without self-exclusion shows that the panel does not count the condition on its own field.
    const assayWithout = (await countsOfElements(request, "library_strategy", [otherAssay], q, false)).get(otherAssay)
    const organismWithout = (await countsOfElements(request, "organism_id", [otherOrganism.identifier], q, false)).get(otherOrganism.identifier)
    skipUnless(assayWithout !== assayCount && organismWithout !== organismCount, "the counts of the other assay and organism do not depend on self-exclusion")
    await page.goto(workspaceUrl({ q }))
    const panel = conditionPanel(page)
    await expect(panel.getByRole("checkbox", { name: otherAssay, exact: true })).toHaveAccessibleDescription(formatCount(assayCount))
    await expect(panel.getByRole("checkbox", { name: otherOrganism.name, exact: true })).toHaveAccessibleDescription(formatCount(organismCount))
  })

  test("the term picker shows the counts of the term search without the conditions on the field of each term", async ({ page, request }) => {
    const { first, second } = await startingPoints(request)
    skipUnless(second, "the dataset has a single disease")
    const q = await select(request, null, first.clauses)
    const hitOf = async (selfExclude: boolean) =>
      (await termSearch(request, second.value, q, selfExclude)).find((term) => term.field === "disease" && term.termId === second.value)
    const hit = await hitOf(true)
    if (!hit) throw new Error("the term search does not return the second disease")
    // Only a count that differs without self-exclusion shows that the picker does not count the condition on the field.
    skipUnless(hit.count !== (await hitOf(false))?.count, "the count of the second disease does not depend on self-exclusion")
    await page.goto(workspaceUrl({ q }))
    await addTermButton(page).click()
    await termPicker(page).getByRole("textbox", { name: "Search terms" }).fill(second.value)
    const row = termPicker(page).getByRole("button").filter({ hasText: second.value })
    await expect(row).toContainText(fieldLabel("disease"))
    await expect(row.locator("span").last()).toHaveText(formatCount(hit.count))
  })

  test("choosing an organism in the panel puts the condition that the api derives from its clause in the URL", async ({ page, request }) => {
    const [organism] = listedOrganisms(await dataset(request))
    if (!organism) throw new Error("the dataset has no listed organism")
    const expected = await select(request, null, [{ field: "organism_id", value: organism.identifier }])
    await page.goto("/entries")
    await conditionPanel(page).getByText(organism.name, { exact: true }).click()
    await expectQ(page, expected)
    await expect(conditionPanel(page).getByRole("checkbox", { name: organism.name, exact: true })).toBeChecked()
  })

  test("typed words and phrases become the keywords of the condition and one row of the condition bar", async ({ page, request }) => {
    const word = await aKeyword(request)
    await page.goto("/entries")
    const box = conditionPanel(page).getByRole("textbox", { name: "Keyword" })
    await box.fill(word)
    await box.press("Enter")
    await expectQ(page, word)
    await expect(conditionRegion(page)).toContainText("Keyword")
    await expect(page.getByRole("main")).toContainText(pageRangeText(await countOf(request, word)))
    await box.fill('"breast cancer" organoid')
    await expectQ(page, 'organoid AND "breast cancer"')
    await expect(conditionRegion(page).getByRole("button", { name: 'Remove organoid "breast cancer"', exact: true })).toBeVisible()
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
    await page.goto(workspaceUrl({ q: "date_published:[2018-01-01 TO 2022-12-31]" }))
    const panel = conditionPanel(page)
    const from = panel.getByLabel("Published from")
    const to = panel.getByLabel("Published to")
    await expect(from).toHaveValue("2018-01-01")
    await expect(to).toHaveValue("2022-12-31")
    await expect(panel.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "false")
    await from.fill("2023-01-01")
    await expect(panel).toContainText("The start is after the end.")
    await expectQ(page, "date_published:[2018-01-01 TO 2022-12-31]")
    await from.fill("")
    await to.fill("")
    await expectQ(page, null)
  })

  test("the date inputs are empty and All is chosen without a date condition", async ({ page, request }) => {
    const { first } = await startingPoints(request)
    await page.goto(workspaceUrl({ q: `disease:"${first.value}"` }))
    const panel = conditionPanel(page)
    await expect(panel.getByLabel("Published from")).toHaveValue("")
    await expect(panel.getByLabel("Published to")).toHaveValue("")
    await expect(panel.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true")
  })

  test("the status buttons show the status condition of the field that has one", async ({ page, request }) => {
    // The select chooses the first field when the condition has no status, so the condition is on the second field.
    const { first: firstField, second: conditionField } = await statusFields(request)
    await page.goto(workspaceUrl({ q: `${conditionField}_status:no_value` }))
    const panel = conditionPanel(page)
    await expectChosen(panel.getByRole("combobox", { name: "Status field" }), fieldLabel(conditionField))
    await expect(panel.getByRole("button", { name: "No value" })).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByRole("button", { name: "Mapped", exact: true })).toHaveAttribute("aria-pressed", "false")
    await choose(panel.getByRole("combobox", { name: "Status field" }), fieldLabel(firstField))
    await expect(panel.getByRole("button", { name: "No value" })).toHaveAttribute("aria-pressed", "false")
    await panel.getByRole("button", { name: "Unmapped" }).click()
    await expectQ(page, `${conditionField}_status:no_value AND ${firstField}_status:unmapped`)
  })

  test("the keywords of the condition are shown in the box and removed from the condition bar", async ({ page, request }) => {
    const { first } = await startingPoints(request)
    const word = await aKeyword(request, [first.label])
    const term = `disease:"${first.value}"`
    await page.goto(workspaceUrl({ q: `${term} AND ${word}` }))
    const box = conditionPanel(page).getByRole("textbox", { name: "Keyword" })
    await expect(box).toHaveValue(word)
    await conditionRegion(page).getByRole("button", { name: `Remove ${word}`, exact: true }).click()
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
    await expect(panel.getByRole("button", { name: `Remove Cell line: ${cellLine.label}` })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: `Remove Tissue: ${tissue.label}` })).toHaveCount(0)
  })

  test("the picker opens on every field and adds the chosen term under its own field", async ({ page, request }) => {
    const { first } = await startingPoints(request)
    await page.goto("/entries")
    await addTermButton(page).click()
    const picker = termPicker(page)
    await expectChosen(picker.getByRole("combobox", { name: "Field", exact: true }), "All fields")
    await picker.getByRole("textbox", { name: "Search terms" }).fill(first.value)
    const hit = picker.getByRole("button").filter({ hasText: first.value })
    await expect(hit).toContainText("Disease")
    await hit.click()
    await expectQ(page, `disease:"${first.value}"`)
    await expect(conditionPanel(page).getByRole("button", { name: `Remove Disease: ${first.label}` })).toBeVisible()
  })
})
