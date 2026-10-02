import { expect, test } from "@playwright/test"

import { distribution, projects, select } from "./_api"
import { expectQ, formatCount, workspaceUrl } from "./_helpers"

test.describe("projects", () => {
  test("the count and the rows of the first page are those of the API, in the order of the chosen sort", async ({ page, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    await page.goto(workspaceUrl({ tab: "projects", q }))
    const main = page.getByRole("main")
    const byCount = await projects(request, q, "biosampleCount:desc")
    await expect(main).toContainText(`${formatCount(byCount.pagination.total)} BioProjects match`)
    const rows = main.locator("tbody tr")
    await expect(rows).toHaveCount(byCount.items.length)
    await expect(rows.first().locator("td").first()).toContainText(byCount.items[0]?.identifier ?? "")
    await main.getByRole("radio", { name: "Accession" }).click()
    const byAccession = await projects(request, q, "identifier:asc")
    await expect(rows.first().locator("td").first()).toContainText(byAccession.items[0]?.identifier ?? "")
    await expect(rows.first().locator("td").nth(2)).toHaveText(formatCount(byAccession.items[0]?.biosampleCount ?? -1))
  })

  test("a row restricts the condition to its project and a second click removes the restriction", async ({ page, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    const [first] = (await projects(request, q, "biosampleCount:desc", 1)).items
    if (!first) throw new Error("the condition matches no BioProject")
    const withProject = await select(request, q, first.clauses)
    await page.goto(workspaceUrl({ tab: "projects", q }))
    const row = page.getByRole("main").locator("tbody tr").first()
    await expect(row.locator("td").first()).toContainText(first.identifier)
    await row.click()
    await expectQ(page, withProject)
    await row.click()
    await expectQ(page, q)
  })
})
