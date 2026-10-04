import { expect, test } from "@playwright/test"

import { entries } from "./_api"

test.describe("finding the API", () => {
  test("the HTML of every page links the OpenAPI document, the Swagger UI, and llms.txt without running its scripts", async ({ browser, request }) => {
    const [first] = (await entries(request, "", 1)).items
    if (!first) throw new Error("the dataset has no BioSample")
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    try {
      for (const path of ["/", "/entries", `/entries/${first.identifier}`]) {
        await page.goto(path)
        const head = page.locator("head")
        await expect(head.locator('link[rel="service-desc"]'), path).toHaveAttribute("href", "/api/openapi.json")
        await expect(head.locator('link[rel="service-doc"]'), path).toHaveAttribute("href", "/api")
        await expect(head.locator('link[rel="alternate"][type="text/markdown"]'), path).toHaveAttribute("href", "/llms.txt")
      }
    } finally {
      await context.close()
    }
  })
})
