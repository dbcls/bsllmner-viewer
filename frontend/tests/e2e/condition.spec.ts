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
})
