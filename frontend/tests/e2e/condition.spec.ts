import { expect, test } from "@playwright/test"

import { addTermButton, conditionPanel, conditionRegion, expectQ, termPicker, workspaceUrl } from "./helpers"

const BREAST_CANCER = "MONDO:0007254"
const CANCER = "MONDO:0004992"

test.describe("condition", () => {
  test("adding a term from the picker puts it in the URL, the condition bar, and the panel", async ({ page }) => {
    await page.goto("/w")
    await addTermButton(page, "Disease").click()
    const picker = termPicker(page)
    await expect(picker).toBeVisible()
    await picker.getByRole("textbox", { name: "Search terms" }).fill("breast cancer")
    await picker.getByRole("button").filter({ hasText: BREAST_CANCER }).click()
    await expect(picker).toBeHidden()
    await expectQ(page, `disease:"${BREAST_CANCER}"`)
    await expect(conditionRegion(page).getByTitle(BREAST_CANCER)).toContainText("breast cancer")
    await expect(conditionPanel(page).getByTitle(BREAST_CANCER)).toContainText("breast cancer")
  })

  test("a term of the same field joins with OR and a different field with AND", async ({ page }) => {
    await page.goto(workspaceUrl({ q: `disease:"${BREAST_CANCER}"` }))
    await conditionPanel(page).getByText("ATAC-seq", { exact: true }).click()
    await expectQ(page, `disease:"${BREAST_CANCER}" AND library_strategy:ATAC-seq`)
    await expect(conditionPanel(page).getByRole("checkbox", { name: /ATAC-seq/ })).toBeChecked()
    await addTermButton(page, "Disease").click()
    await termPicker(page).getByRole("textbox", { name: "Search terms" }).fill("cancer")
    await termPicker(page).getByRole("button").filter({ hasText: CANCER }).click()
    await expectQ(page, `(disease:"${BREAST_CANCER}" OR disease:"${CANCER}") AND library_strategy:ATAC-seq`)
    await expect(conditionRegion(page).getByText("AND", { exact: true })).toBeVisible()
    await expect(conditionRegion(page).getByText("OR", { exact: true })).toBeVisible()
  })

  test("removing a chip drops its clause and Clear all empties the condition", async ({ page }) => {
    await page.goto(workspaceUrl({ q: `disease:"${BREAST_CANCER}" AND library_strategy:ATAC-seq` }))
    await conditionRegion(page).getByTitle(BREAST_CANCER).getByRole("button", { name: "Remove" }).click()
    await expectQ(page, "library_strategy:ATAC-seq")
    await conditionRegion(page).getByRole("button", { name: "Clear all" }).click()
    await expectQ(page, null)
    await expect(conditionRegion(page)).toContainText("No condition")
  })

  test("the query editor applies a typed condition in its canonical form and reports a syntax error", async ({ page }) => {
    await page.goto("/w")
    const region = conditionRegion(page)
    await region.getByRole("radio", { name: "Query" }).click()
    const editor = region.getByRole("textbox", { name: "Condition" })
    await editor.fill(`( disease:"${BREAST_CANCER}" )   AND library_strategy:RNA-Seq`)
    await region.getByRole("button", { name: "Apply" }).click()
    await expectQ(page, `disease:"${BREAST_CANCER}" AND library_strategy:RNA-Seq`)
    await expect(editor).toHaveValue(`disease:"${BREAST_CANCER}" AND library_strategy:RNA-Seq`)
    await editor.fill("disease:")
    await region.getByRole("button", { name: "Apply" }).click()
    await expect(region).toContainText("unexpected token")
    await expectQ(page, `disease:"${BREAST_CANCER}" AND library_strategy:RNA-Seq`)
  })

  test("the created-year range replaces the previous range instead of joining it", async ({ page }) => {
    await page.goto("/w")
    const panel = conditionPanel(page)
    await panel.getByRole("textbox", { name: "From year" }).fill("2015")
    await panel.getByRole("textbox", { name: "To year" }).fill("2016")
    await panel.getByRole("button", { name: "Apply" }).click()
    await expectQ(page, "date_created:[2015-01-01 TO 2016-12-31]")
    await panel.getByRole("textbox", { name: "From year" }).fill("2018")
    await panel.getByRole("textbox", { name: "To year" }).fill("2019")
    await panel.getByRole("button", { name: "Apply" }).click()
    await expectQ(page, "date_created:[2018-01-01 TO 2019-12-31]")
    await expect(conditionRegion(page)).toContainText("2018–2019")
  })

  test("a text match is added on Enter as a contains clause", async ({ page }) => {
    await page.goto("/w")
    const title = conditionPanel(page).getByRole("textbox", { name: "Title contains" })
    await title.fill("run1")
    await title.press("Enter")
    await expectQ(page, "title:run1")
    await expect(conditionRegion(page)).toContainText("Title contains")
    await expect(conditionRegion(page)).toContainText("“run1”")
  })

  test("the year inputs show the range of the condition and reject an invalid range", async ({ page }) => {
    await page.goto(workspaceUrl({ q: "date_created:[2018-01-01 TO 2022-12-31]" }))
    const panel = conditionPanel(page)
    const from = panel.getByRole("textbox", { name: "From year" })
    const to = panel.getByRole("textbox", { name: "To year" })
    const apply = panel.getByRole("button", { name: "Apply" })
    await expect(from).toHaveValue("2018")
    await expect(to).toHaveValue("2022")
    await expect(apply).toBeDisabled()
    await from.fill("2023")
    await expect(panel).toContainText("The first year is after the last year.")
    await expect(apply).toBeDisabled()
    await from.fill("20")
    await expect(panel).toContainText("Enter both years with four digits.")
    await from.fill("")
    await to.fill("")
    await apply.click()
    await expectQ(page, null)
  })

  test("the year inputs are empty without a year condition", async ({ page }) => {
    await page.goto(workspaceUrl({ q: `disease:"${BREAST_CANCER}"` }))
    const panel = conditionPanel(page)
    await expect(panel.getByRole("textbox", { name: "From year" })).toHaveValue("")
    await expect(panel.getByRole("textbox", { name: "To year" })).toHaveValue("")
    await expect(panel.getByRole("button", { name: "Apply" })).toBeDisabled()
  })

  test("the status buttons show the status condition of the field that has one", async ({ page }) => {
    await page.goto(workspaceUrl({ q: "tissue_status:no_value" }))
    const panel = conditionPanel(page)
    await expect(panel.getByRole("combobox", { name: "Status field" })).toHaveValue("tissue")
    await expect(panel.getByRole("button", { name: "No value" })).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByRole("button", { name: "Mapped", exact: true })).toHaveAttribute("aria-pressed", "false")
    await panel.getByRole("combobox", { name: "Status field" }).selectOption("disease")
    await expect(panel.getByRole("button", { name: "No value" })).toHaveAttribute("aria-pressed", "false")
    await panel.getByRole("button", { name: "Unmapped" }).click()
    await expectQ(page, "tissue_status:no_value AND disease_status:unmapped")
  })

  test("a text match in the condition is shown in the panel and can be removed there", async ({ page }) => {
    await page.goto(workspaceUrl({ q: "title:run1 AND disease_value:cancer" }))
    const panel = conditionPanel(page)
    await expect(panel).toContainText("Title contains “run1”")
    await expect(panel).toContainText("Disease contains “cancer”")
    await panel.getByTitle("Title contains").getByRole("button", { name: "Remove" }).click()
    await expectQ(page, "disease_value:cancer")
  })

  test("a negated clause and a disjunction over several fields are not shown as selections in the panel", async ({ page }) => {
    await page.goto(workspaceUrl({ q: 'NOT library_strategy:RNA-Seq AND (cell_line:"CVCL:0031" OR tissue:"UBERON:0002107")' }))
    const panel = conditionPanel(page)
    await expect(conditionRegion(page)).toContainText("NOT Assay: RNA-Seq")
    await expect(conditionRegion(page)).toContainText("Cell line: MCF-7 OR Tissue: liver")
    await expect(panel.getByRole("checkbox", { name: /RNA-Seq/ })).not.toBeChecked()
    await expect(panel.getByTitle("CVCL:0031")).toHaveCount(0)
    await expect(panel.getByTitle("UBERON:0002107")).toHaveCount(0)
  })

  test("the picker searches every field and adds the chosen term under its own field", async ({ page }) => {
    await page.goto("/w")
    await addTermButton(page, "Tissue").click()
    const picker = termPicker(page)
    await picker.getByRole("combobox", { name: "Field", exact: true }).selectOption("*")
    await picker.getByRole("textbox", { name: "Search terms" }).fill("breast cancer")
    const hit = picker.getByRole("button").filter({ hasText: BREAST_CANCER })
    await expect(hit).toContainText("Disease")
    await hit.click()
    await expectQ(page, `disease:"${BREAST_CANCER}"`)
    await expect(conditionPanel(page).getByTitle(BREAST_CANCER)).toContainText("breast cancer")
  })
})
