import { expect, test } from "@playwright/test"

import { distribution, projects, select } from "./_api"
import { choose, expectParam, expectQ, formatCount, pageRangeText, TABLE_PER_PAGE, workspaceUrl } from "./_helpers"

test.describe("projects", () => {
  test("the count and the rows of the first page are those of the API, in the order of the chosen sort", async ({ page, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    await page.goto(workspaceUrl({ tab: "projects", q }))
    const main = page.getByRole("main")
    const byCount = await projects(request, q, "biosampleCount:desc")
    await expect(main).toContainText(pageRangeText(byCount.pagination.total))
    const rows = main.locator("tbody tr")
    await expect(rows).toHaveCount(byCount.items.length)
    await expect(rows.first().locator("td").first()).toContainText(byCount.items[0]?.identifier ?? "")
    await choose(main.getByRole("combobox", { name: "Sort by" }), "Accession")
    await expectParam(page, "sort", "identifier:asc")
    const byAccession = await projects(request, q, "identifier:asc")
    await expect(rows.first().locator("td").first()).toContainText(byAccession.items[0]?.identifier ?? "")
    await expect(rows.first().locator("td").nth(2)).toHaveText(formatCount(byAccession.items[0]?.biosampleCount ?? -1))
    await main.getByRole("button", { name: "Sort descending" }).click()
    await expectParam(page, "sort", "identifier:desc")
    const reversed = await projects(request, q, "identifier:desc")
    await expect(rows.first().locator("td").first()).toContainText(reversed.items[0]?.identifier ?? "")
  })

  test("the pager moves to the next page and shows the range of that page", async ({ page, request }) => {
    const first = await projects(request, null, "biosampleCount:desc")
    test.skip(first.pagination.total <= TABLE_PER_PAGE, "the dataset has a single page of BioProjects")
    const second = await projects(request, null, "biosampleCount:desc", TABLE_PER_PAGE, 2)
    await page.goto(workspaceUrl({ tab: "projects" }))
    const main = page.getByRole("main")
    await main.getByRole("button", { name: "Next page" }).first().click()
    await expectParam(page, "page", "2")
    await expect(main).toContainText(pageRangeText(first.pagination.total, 2))
    await expect(main.locator("tbody tr").first().locator("td").first()).toContainText(second.items[0]?.identifier ?? "")
  })

  test("a row restricts the condition to its project and a second click removes the restriction", async ({ page, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    const [first] = (await projects(request, q, "biosampleCount:desc", 1)).items
    if (!first) throw new Error("the condition matches no BioProject")
    const withProject = await select(request, q, first.clauses)
    await page.goto(workspaceUrl({ tab: "projects", q }))
    const rows = page.getByRole("main").locator("tbody tr")
    await expect(rows.first().locator("td").first()).toContainText(first.identifier)
    await rows.first().click()
    await expectQ(page, withProject)
    await expect(rows).toHaveCount(1)
    await rows.first().click()
    await expectQ(page, q)
  })

  test("the view tabs show no counting unit and no self-exclusion with the projects", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "projects" }))
    await expect(page.getByRole("main").locator("tbody tr").first()).toBeVisible()
    await expect(page.getByRole("radiogroup", { name: "Counting unit" })).toHaveCount(0)
    await expect(page.getByRole("switch")).toHaveCount(0)
  })
})
