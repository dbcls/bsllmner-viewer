import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

import { distribution, entries, select, smallProjects } from "./_api"
import { expectCounted, fieldLabel, workspaceUrl } from "./_helpers"

test.describe("outputs of the condition", () => {
  test("the export menu links carry the condition, and the entry exports show their likely size", async ({ page, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    await page.goto(workspaceUrl({ q }))
    await expectCounted(page)
    await page.getByRole("button", { name: "Export" }).click()
    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible()
    const expected = [
      { name: /^TSV/, path: "/api/export/entries/biosample", format: "tsv" },
      { name: /^NDJSON/, path: "/api/export/entries/biosample", format: "ndjson" },
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
    // The size is an estimate from the number of entries. The menu shows no row count.
    for (const name of [/^TSV/, /^NDJSON/]) {
      const item = menu.getByRole("menuitem", { name })
      await expect(item).toContainText(/(~[\d.,]+ [KMGT]B|<1 KB)$/)
      await expect(item).not.toContainText("rows")
    }
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
    expect((await read(/^TSV/)).length).toBe(total + 1)
    expect((await read(/^NDJSON/)).length).toBe(total)
    expect(await read(/BioProject/)).toEqual([project.identifier])
    expect((await read(/BioSample/)).length).toBe(total)
  })

  test("the API modal lists the request of every Distribution card in the order of the cards and shows the response of the first", async ({ page, request }) => {
    const [term] = (await distribution(request, "disease")).elements
    if (!term) throw new Error("the dataset has no disease")
    const q = await select(request, null, term.clauses)
    await page.goto(workspaceUrl({ q, tab: "distribution", unit: "bioproject" }))
    await expectCounted(page)
    const exports = page.getByRole("main").getByRole("button", { name: /^Export the .+ distribution$/ })
    await expect(exports.first()).toBeVisible()
    const cards = (await exports.evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label") ?? ""))).map((name) =>
      name.replace(/^Export the /, "").replace(/ distribution$/, ""),
    )
    await page.getByRole("button", { name: "API", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Same result via the API" })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("one request for the current condition, counted in the same unit, in the order of the cards")
    const curl = (await dialog.locator("pre").first().innerText()).replace(/\\\s+/g, " ")
    const shown = [...curl.matchAll(/curl -s "([^"]+)"/g)].map((match) => new URL(match[1] ?? ""))
    expect(shown.length).toBe(cards.length)
    expect(shown.map((url) => fieldLabel(url.searchParams.get("field") ?? ""))).toEqual(cards)
    for (const url of shown) {
      expect(url.pathname).toBe("/api/distribution")
      expect(url.searchParams.get("q")).toBe(q)
      expect(url.searchParams.get("unit")).toBe("bioproject")
      expect(url.searchParams.get("facetSelfExclude")).toBe("true")
    }
    const [firstShown] = shown
    const firstField = firstShown?.searchParams.get("field") ?? ""
    const expected = await distribution(request, firstField, { q, unit: "bioproject" })
    const response = await request.get(`${firstShown?.pathname}${firstShown?.search}`)
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
