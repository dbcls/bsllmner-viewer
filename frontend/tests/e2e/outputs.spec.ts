import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

import { countOf, distribution, entries, select, smallProjects } from "./_api"
import { expectCounted, formatCount, workspaceUrl } from "./_helpers"

test.describe("outputs of the condition", () => {
  test("the export menu links carry the condition and the entry count", async ({ page, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    await page.goto(workspaceUrl({ q }))
    await expectCounted(page)
    await page.getByRole("button", { name: "Export" }).click()
    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible()
    const expected = [
      { name: /Entries · TSV/, path: "/api/export/entries/biosample", format: "tsv" },
      { name: /Entries · JSON lines/, path: "/api/export/entries/biosample", format: "ndjson" },
      { name: /BioSample/, path: "/api/export/accessions/biosample", format: null },
      { name: /SRA Experiment/, path: "/api/export/accessions/sra-experiment", format: null },
      { name: /SRA Run/, path: "/api/export/accessions/sra-run", format: null },
      { name: /BioProject/, path: "/api/export/accessions/bioproject", format: null },
    ]
    for (const { name, path, format } of expected) {
      const href = await menu.getByRole("menuitem", { name }).getAttribute("href")
      const url = new URL(href ?? "", page.url())
      expect(url.pathname).toBe(path)
      expect(url.searchParams.get("q")).toBe(q)
      expect(url.searchParams.get("format")).toBe(format)
    }
    await expect(menu.getByRole("menuitem", { name: /Entries · TSV/ })).toContainText(`${formatCount(await countOf(request, q))} rows`)
    await page.keyboard.press("Escape")
    await expect(menu).toBeHidden()
  })

  test("the exports of a small condition hold exactly its entries", async ({ page, request }) => {
    const [project] = await smallProjects(request)
    if (!project) throw new Error("no small BioProject")
    const q = await select(request, null, project.clauses)
    const total = (await entries(request, q, 1)).pagination.total
    await page.goto(workspaceUrl({ q }))
    await expectCounted(page)
    const read = async (name: RegExp): Promise<string[]> => {
      await page.getByRole("button", { name: "Export" }).click()
      const item = page.getByRole("menuitem", { name })
      await expect(item).toBeVisible()
      const [download] = await Promise.all([page.waitForEvent("download"), item.click()])
      await page.keyboard.press("Escape")
      await expect(page.getByRole("menu")).toBeHidden()
      const path = await download.path()
      return (await readFile(path, "utf8")).split("\n").filter((line) => line !== "" && !line.startsWith("#"))
    }
    expect((await read(/Entries · TSV/)).length).toBe(total + 1)
    expect((await read(/Entries · JSON lines/)).length).toBe(total)
    expect(await read(/BioProject/)).toEqual([project.identifier])
    expect((await read(/BioSample/)).length).toBe(total)
  })

  test("the API modal shows the request for the current view and its response", async ({ page, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    const expected = await distribution(request, "disease", { q, unit: "bioproject" })
    await page.goto(workspaceUrl({ q, tab: "distribution", unit: "bioproject" }))
    await expectCounted(page)
    await page.getByRole("button", { name: "API", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Same result via the API" })
    await expect(dialog).toBeVisible()
    const curl = (await dialog.locator("pre").first().innerText()).replace(/\\\s+/g, " ")
    const shown = new URL(/curl -s "([^"]+)"/.exec(curl)?.[1] ?? "")
    expect(shown.pathname).toBe("/api/distribution")
    expect(shown.searchParams.get("q")).toBe(q)
    expect(shown.searchParams.get("unit")).toBe("bioproject")
    expect(shown.searchParams.get("field")).toBe("disease")
    expect(shown.searchParams.get("facetSelfExclude")).toBe("true")
    const response = await request.get(`${shown.pathname}${shown.search}`)
    expect(response.ok()).toBe(true)
    expect(((await response.json()) as { total: number }).total).toBe(expected.total)
    await expect(dialog).toContainText(`"total": ${expected.total}`)
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  })

  test("Share copies the current URL", async ({ page, context, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await page.goto(workspaceUrl({ q }))
    await expectCounted(page)
    await page.getByRole("button", { name: /^(Share|Copied!)$/ }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(page.url())
  })
})
