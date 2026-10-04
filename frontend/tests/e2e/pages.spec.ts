import { expect, type Page, test } from "@playwright/test"

import { dataset, entries, get } from "./_api"
import { workspaceUrl } from "./_helpers"

// The name of the site and of the section are constants of the application, not values of the dataset.
const SITE = "bsllmner-viewer"
const title = (...names: string[]): string => [...names, SITE].join(" | ")

const MISSING_PATH = "/no-such-page"

/** The accession of the first BioSample of the dataset, and an accession that the dataset cannot have. */
const accessions = async (request: Parameters<typeof dataset>[0]) => {
  const assay = (await dataset(request)).targetAssays[0]
  if (!assay) throw new Error("the dataset has no target assay")
  const first = (await entries(request, `library_strategy:${assay}`, 1)).items[0]
  if (!first) throw new Error("the dataset has no BioSample")
  const missing = "SAMN99999999999"
  const response = await request.get(`/api/entries/biosample/${missing}`)
  expect(response.status()).toBe(404)
  return { accession: first.identifier, missing }
}

const metaContent = (page: Page, name: string) => page.locator(`head meta[name="${name}"]`)

const canonical = (page: Page) => page.locator('head link[rel="canonical"]')

/**
 * Opens a page that has a canonical address and waits until the application has drawn it. The HTML file of every page
 * has the title and the description of the site and no canonical link, so the head says nothing about a page before it
 * is drawn.
 */
const openDrawn = async (page: Page, path: string): Promise<void> => {
  await page.goto(path)
  await expect(canonical(page)).toHaveAttribute("href", new URL(path, page.url()).href)
}

test.describe("pages", () => {
  test("every page has a title made of its names from the page up to the site", async ({ page, request }) => {
    const { accession } = await accessions(request)
    await openDrawn(page, "/")
    await expect(page).toHaveTitle(SITE)
    await page.goto("/entries")
    await expect(page).toHaveTitle(title("Entries"))
    await page.goto(`/entries/${accession}`)
    await expect(page).toHaveTitle(title(accession, "Entries"))
    await page.goto(MISSING_PATH)
    await expect(page).toHaveTitle(title("Not Found"))
  })

  test("the top page and the workspace have a description, and the page of a BioSample has a description of its BioSample", async ({ page, request }) => {
    const { accession } = await accessions(request)
    for (const path of ["/", "/entries"]) {
      await openDrawn(page, path)
      await expect(metaContent(page, "description")).toHaveAttribute("content", /\S/)
    }
    await openDrawn(page, `/entries/${accession}`)
    await expect(metaContent(page, "description")).toHaveAttribute("content", new RegExp(`BioSample ${accession}\\b`))
  })

  test("the canonical link is on the top page, the workspace without parameters, and the page of a BioSample, and not on the workspace with parameters", async ({ page, request }) => {
    const { accession } = await accessions(request)
    for (const path of ["/", "/entries", `/entries/${accession}`]) await openDrawn(page, path)
    await page.goto(workspaceUrl({ tab: "heatmap" }))
    await expect(page).toHaveTitle(title("Entries"))
    await expect(canonical(page)).toHaveCount(0)
  })

  test("a page that names nothing that exists has a noindex robots meta and the other pages have none", async ({ page, request }) => {
    const { accession, missing } = await accessions(request)
    const robots = metaContent(page, "robots")
    await page.goto(MISSING_PATH)
    await expect(robots).toHaveAttribute("content", "noindex")
    await page.goto(`/entries/${missing}`)
    await expect(page).toHaveTitle(title(missing, "Entries"))
    await expect(robots).toHaveAttribute("content", "noindex")
    for (const path of ["/", "/entries", `/entries/${accession}`]) {
      await openDrawn(page, path)
      await expect(metaContent(page, "description")).toHaveCount(1)
      await expect(robots).toHaveCount(0)
    }
  })

  test("a path that does not exist answers 404 and shows the not found page with a link to the top page", async ({ page }) => {
    const response = await page.goto(MISSING_PATH)
    expect(response?.status()).toBe(404)
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toContainText("404")
    await page.getByRole("main").getByRole("link", { name: "Go to the top page" }).click()
    await expect(page).toHaveURL("/")
    await expect(page).toHaveTitle(SITE)
  })

  test("the top page has a schema.org Dataset whose name, version, and counts come from the dataset api", async ({ page, request }) => {
    const data = await get<{ datasetVersion: { name: string; createdAt: string }; totals: { biosample: number }; fields: { name: string }[] }>(request, "/api/dataset")
    await page.goto("/")
    const script = page.locator('script[type="application/ld+json"]')
    await expect(script).toHaveCount(1)
    const schema = JSON.parse((await script.textContent()) ?? "") as Record<string, unknown>
    expect(schema["@type"]).toBe("Dataset")
    expect(schema["version"]).toBe(data.datasetVersion.name)
    expect(schema["dateModified"]).toBe(data.datasetVersion.createdAt)
    expect(schema["description"]).toContain(data.totals.biosample.toLocaleString("en-US"))
    expect(schema["variableMeasured"]).toHaveLength(data.fields.length)
    expect(schema["url"]).toBe(new URL("/", page.url()).href)
  })

  test("opening another page moves the focus to the frame of the shell and announces the title, and a change of the parameters alone keeps the focus", async ({ page, request }) => {
    const { accession } = await accessions(request)
    const active = () => page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName)
    await page.goto(`/entries/${accession}`)
    await expect(page).toHaveTitle(title(accession, "Entries"))
    await page.getByRole("link", { name: "Back to Samples" }).click()
    await expect(page).toHaveTitle(title("Entries"))
    await expect.poll(active).toBe("shell")
    await expect(page.getByRole("status").filter({ hasText: title("Entries") })).toHaveCount(1)
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused()
    const tab = page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Heatmap" })
    await tab.click()
    await expect(tab).toHaveAttribute("aria-current", "page")
    await expect(tab).toBeFocused()
  })
})
