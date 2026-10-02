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
    await choose(main.getByRole("combobox", { name: "Sort by" }), "SRA Experiments")
    await expectParam(page, "sort", "experimentCount:desc")
    const byExperiments = await projects(request, q, "experimentCount:desc")
    await expect(rows.first().locator("td").first()).toContainText(byExperiments.items[0]?.identifier ?? "")
    await expect(rows.first().locator("td").nth(3)).toHaveText(formatCount(byExperiments.items[0]?.experimentCount ?? -1))
    await main.getByRole("button", { name: "Sort ascending" }).click()
    await expectParam(page, "sort", "experimentCount:asc")
    const reversed = await projects(request, q, "experimentCount:asc")
    await expect(rows.first().locator("td").first()).toContainText(reversed.items[0]?.identifier ?? "")
    await expect(rows.first().locator("td").nth(3)).toHaveText(formatCount(reversed.items[0]?.experimentCount ?? -1))
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

  test("Add puts a project into the condition and keeps the other projects, and Remove takes it out", async ({ page, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    const listed = await projects(request, q, "biosampleCount:desc")
    const [first] = listed.items
    if (!first) throw new Error("the condition matches no BioProject")
    const withProject = await select(request, q, first.clauses)
    await page.goto(workspaceUrl({ tab: "projects", q }))
    const main = page.getByRole("main")
    const rows = main.locator("tbody tr")
    await expect(rows).toHaveCount(listed.items.length)
    await rows.first().locator("td").nth(1).click()
    await expectQ(page, q)
    await main.getByRole("button", { name: `Add ${first.identifier} to the condition` }).click()
    await expectQ(page, withProject)
    await expect(main).toContainText(pageRangeText(listed.pagination.total))
    await expect(rows).toHaveCount(listed.items.length)
    await main.getByRole("button", { name: `Remove ${first.identifier} from the condition` }).click()
    await expectQ(page, q)
    await expect(main.getByRole("button", { name: `Add ${first.identifier} to the condition` })).toBeVisible()
  })

  test("the DDBJ link of a row opens the DDBJ Search page of its project and keeps the condition", async ({ page, request }) => {
    const [first] = (await projects(request, null, "biosampleCount:desc", 1)).items
    if (!first) throw new Error("the dataset has no BioProject")
    const href = `https://ddbj.nig.ac.jp/search/entry/bioproject/${first.identifier}`
    await page.context().route(href, (route) => route.fulfill({ contentType: "text/html", body: "" }))
    await page.goto(workspaceUrl({ tab: "projects" }))
    const link = page.getByRole("main").locator("tbody tr").first().getByRole("link", { name: /DDBJ/ })
    await expect(link).toHaveAttribute("href", href)
    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()])
    expect(popup.url()).toBe(href)
    await popup.close()
    await expectQ(page, null)
  })

  test("the projects show no counting unit", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "projects" }))
    await expect(page.getByRole("main").locator("tbody tr").first()).toBeVisible()
    await expect(page.getByRole("radiogroup", { name: "Counting unit" })).toHaveCount(0)
  })
})
