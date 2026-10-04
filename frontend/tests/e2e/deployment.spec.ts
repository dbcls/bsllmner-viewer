import { expect, test } from "@playwright/test"

import { EXPECTED } from "./playwright.config"

/**
 * What the deployment shows search engines and whoever watches it. These check the deployment against
 * what it was meant to be, which the runner passes in (`EXPECTED`).
 */
test.describe("deployment", () => {
  test("a deployment that search engines may index disallows only the workspace with parameters, and marks only the exports noindex", async ({ page, request }) => {
    test.skip(EXPECTED.noindex !== "false", "BSLLMNER_VIEWER_E2E_NOINDEX=false is not given")
    const robots = (await (await request.get("/robots.txt")).text()).split("\n").map((line) => line.trim())
    expect(robots.filter((line) => line.startsWith("Disallow:"))).toEqual(["Disallow: /entries?"])
    for (const path of ["/", "/entries", "/api/service-info", "/llms.txt", "/llms-full.txt"]) {
      const response = await page.goto(path)
      expect(response?.headers()["x-robots-tag"], path).toBeUndefined()
    }
    // A condition that matches no BioProject, so that the export is one header line.
    const exported = await request.get("/api/export/accessions/bioproject", { params: { q: "bioproject:PRJNA0" } })
    expect(exported.status()).toBe(200)
    expect(exported.headers()["x-robots-tag"]).toContain("noindex")
  })

  test("a deployment that search engines must not index allows only the API, llms.txt, and llms-full.txt and marks every response noindex", async ({ page, request }) => {
    test.skip(EXPECTED.noindex !== "true", "BSLLMNER_VIEWER_E2E_NOINDEX=true is not given")
    const robots = (await (await request.get("/robots.txt")).text()).split("\n").map((line) => line.trim()).filter((line) => line !== "")
    expect(robots).toEqual(["User-agent: *", "Allow: /api", "Allow: /llms.txt", "Allow: /llms-full.txt", "Disallow: /"])
    for (const path of ["/", "/entries", "/api/service-info", "/llms.txt", "/llms-full.txt"]) {
      const response = await page.goto(path)
      expect(response?.headers()["x-robots-tag"], path).toContain("noindex")
    }
  })

  test("llms.txt describes the site in Markdown", async ({ request }) => {
    const response = await request.get("/llms.txt")
    expect(response.status()).toBe(200)
    expect(await response.text()).toMatch(/^# \S+/)
  })

  test("the version of the API and the footer show the deployed commit", async ({ page, request }) => {
    test.skip(EXPECTED.commit === "", "BSLLMNER_VIEWER_E2E_COMMIT is not given")
    const { version } = (await (await request.get("/api/service-info")).json()) as { version: string }
    expect(version.endsWith(`+${EXPECTED.commit}`)).toBe(true)
    await page.goto("/")
    await expect(page.locator("footer")).toContainText(`Version ${EXPECTED.commit}`)
  })
})
