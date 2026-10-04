import { type APIRequestContext, expect, test } from "@playwright/test"

import { EXPECTED } from "./playwright.config"

/** A path that is neither a file nor a page of the application. */
const MISSING_PAGE = "/no-such-page"

/** An asset that the build did not make. */
const MISSING_ASSET = "/assets/no-such-file.js"

/** The limit of a request body of the web server. */
const BODY_LIMIT = 64 * 1024

/**
 * The runner gives the NOINDEX of the deployment only for a deployment. The web server of the deployment serves it, and a
 * development server does not have the headers, the limits, and the redirects of that web server.
 */
const isDeployment = EXPECTED.noindex !== ""

/** A script that the HTML of the top page loads, which the build writes under /assets/. */
const firstAsset = async (request: APIRequestContext): Promise<string> => {
  const html = await (await request.get("/")).text()
  const asset = /"(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
  if (!asset) throw new Error("the HTML of the top page loads no script under /assets/")
  return asset
}

/** Exports of each kind, for a condition that matches no BioProject, and an export that the api rejects. */
const EXPORTS = [
  "/api/export/entries/biosample?format=tsv&q=bioproject:PRJNA0",
  "/api/export/entries/biosample?format=ndjson&q=bioproject:PRJNA0",
  "/api/export/accessions/bioproject?q=bioproject:PRJNA0",
  "/api/export/accessions/bioproject?q=(",
]

/** The directives of a Content-Security-Policy header, by name. */
const directives = (policy: string | undefined): Map<string, string> =>
  new Map((policy ?? "").split(";").map((directive) => directive.trim()).filter(Boolean).map((directive) => {
    const [name = "", ...values] = directive.split(/\s+/)
    return [name, values.join(" ")]
  }))

/**
 * What the deployment shows to search engines and to monitoring tools. The tests in this group check the deployment
 * against what it was meant to be, which the runner passes in (`EXPECTED`).
 */
test.describe("deployment", () => {
  test("a deployment that search engines may index disallows only the workspace with parameters and does not mark its pages noindex", async ({ page, request }) => {
    test.skip(EXPECTED.noindex !== "false", "BSLLMNER_VIEWER_E2E_NOINDEX=false is not given")
    const robots = (await (await request.get("/robots.txt")).text()).split("\n").map((line) => line.trim())
    expect(robots.filter((line) => line.startsWith("Disallow:"))).toEqual(["Disallow: /entries?"])
    for (const path of ["/", "/entries", "/api/service-info", "/llms.txt", "/llms-full.txt"]) {
      const response = await page.goto(path)
      expect(response?.headers()["x-robots-tag"], path).toBeUndefined()
    }
  })

  test("a deployment that search engines must not index allows only the API, llms.txt, and llms-full.txt and marks every response noindex", async ({ page, request }) => {
    test.skip(EXPECTED.noindex !== "true", "BSLLMNER_VIEWER_E2E_NOINDEX=true is not given")
    const robots = (await (await request.get("/robots.txt")).text()).split("\n").map((line) => line.trim()).filter((line) => line !== "")
    expect(robots).toEqual(["User-agent: *", "Allow: /api", "Allow: /llms.txt", "Allow: /llms-full.txt", "Disallow: /"])
    for (const path of ["/", "/entries", "/api/service-info", "/llms.txt", "/llms-full.txt"]) {
      const response = await page.goto(path)
      expect(response?.headers()["x-robots-tag"], path).toContain("noindex")
    }
    for (const path of [MISSING_PAGE, MISSING_ASSET, await firstAsset(request), "/api/entries/biosample/SAMN0"]) {
      expect((await request.get(path)).headers()["x-robots-tag"], path).toContain("noindex")
    }
  })

  test("every export is marked noindex, including an export that the api rejects", async ({ request }) => {
    test.skip(!isDeployment, "BSLLMNER_VIEWER_E2E_NOINDEX is not given")
    for (const path of EXPORTS) {
      expect((await request.get(path)).headers()["x-robots-tag"], path).toContain("noindex")
    }
  })

  test("the version of the API and the footer show the deployed commit", async ({ page, request }) => {
    test.skip(EXPECTED.commit === "", "BSLLMNER_VIEWER_E2E_COMMIT is not given")
    const { version } = (await (await request.get("/api/service-info")).json()) as { version: string }
    expect(version.endsWith(`+${EXPECTED.commit}`)).toBe(true)
    await page.goto("/")
    await expect(page.locator("footer")).toContainText(`Version ${EXPECTED.commit}`)
  })

  test("llms-full.txt links the docs of the deployed commit", async ({ request }) => {
    test.skip(EXPECTED.commit === "", "BSLLMNER_VIEWER_E2E_COMMIT is not given")
    const full = await (await request.get("/llms-full.txt")).text()
    const addresses = [...full.matchAll(/\]\((https:\/\/github\.com\/dbcls\/bsllmner-viewer\/[^)\s]+)\)/g)].map((match) => match[1] as string)
    expect(addresses.length).toBeGreaterThan(0)
    for (const address of addresses) expect(address).toContain(`/blob/${EXPECTED.commit}/`)
  })
})

/**
 * The headers, the limits, and the redirects of the web server in front of the api. They do not depend on the NOINDEX of
 * the deployment, but a runner gives NOINDEX only for a deployment, and a development server has no such web server.
 */
test.describe("web server", () => {
  test.skip(!isDeployment, "BSLLMNER_VIEWER_E2E_NOINDEX is not given, so the address is not a deployment")

  test("/openapi.json redirects permanently to /api/openapi.json with a relative address", async ({ request }) => {
    const response = await request.get("/openapi.json", { maxRedirects: 0 })
    expect(response.status()).toBe(301)
    expect(response.headers()["location"]).toBe("/api/openapi.json")
  })

  test("a request body over 64 KiB gets a 413 problem response that any origin can read, and a body of 64 KiB reaches the api", async ({ request }) => {
    const post = (size: number) =>
      // A Buffer is sent as it is. A string would be sent as a JSON string, with two more bytes for its quotes.
      request.post("/api/dsl/select", { data: Buffer.alloc(size, "x"), headers: { "Content-Type": "application/json", Origin: "https://example.org" } })
    const tooLarge = await post(BODY_LIMIT + 1)
    expect(tooLarge.status()).toBe(413)
    expect(tooLarge.headers()["content-type"]).toContain("application/problem+json")
    const problem = (await tooLarge.json()) as { status: number; requestId: string }
    expect(problem.status).toBe(413)
    expect(problem.requestId).toBe(tooLarge.headers()["x-request-id"])
    expect(tooLarge.headers()["access-control-allow-origin"]).toBe("*")
    expect(tooLarge.headers()["access-control-expose-headers"]).toBe("Retry-After, X-Request-ID")
    // The api answers a body that is not JSON with 422, so a 422 shows that the body passed the web server.
    expect((await post(BODY_LIMIT)).status()).toBe(422)
  })

  test("pages and api responses have the security headers, and only the API documentation allows the CDNs and inline scripts", async ({ request }) => {
    for (const path of ["/", "/entries", MISSING_PAGE, "/api/service-info", "/api", "/api/redoc"]) {
      const headers = (await request.get(path)).headers()
      expect(headers["x-frame-options"], path).toBe("DENY")
      expect(headers["permissions-policy"], path).toBeTruthy()
      const policy = directives(headers["content-security-policy"])
      expect(policy.get("frame-ancestors"), path).toBe("'none'")
      if (path === "/api/service-info") expect(headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'")
      else if (path.startsWith("/api")) {
        expect(policy.get("script-src"), path).toContain("https://cdn.jsdelivr.net")
        expect(policy.get("script-src"), path).toContain("'unsafe-inline'")
      } else {
        expect(policy.get("script-src"), path).toMatch(/^'self'/)
        expect(policy.get("script-src"), path).not.toContain("https://cdn.jsdelivr.net")
        expect(policy.get("script-src"), path).not.toContain("unsafe-inline")
      }
    }
  })

  test("the pages and the API documentation draw without a violation of their content security policy", async ({ page }) => {
    await page.addInitScript(() => {
      const record = window as unknown as { cspViolations: string[] }
      record.cspViolations = []
      document.addEventListener("securitypolicyviolation", (event) => record.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`))
    })
    const violations = () => page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)
    for (const path of ["/", "/entries"]) {
      await page.goto(path)
      // The application adds the canonical link when it has drawn the page.
      await expect(page.locator('head link[rel="canonical"]'), path).toHaveCount(1)
      expect(await violations(), path).toEqual([])
    }
    await page.goto("/api")
    // Swagger UI writes the title of the OpenAPI document when its scripts from the CDN have run.
    await expect(page.locator(".swagger-ui .info .title")).toContainText("bsllmner-viewer API")
    expect(await violations(), "/api").toEqual([])
  })

  test("a request that the reverse proxy forwarded as https gets HSTS for one year without includeSubDomains or preload", async ({ request }) => {
    const response = await request.get("/", { headers: { "X-Forwarded-Proto": "https" } })
    expect(response.headers()["strict-transport-security"]).toBe("max-age=31536000")
  })

  test("a path that is neither a file nor a page is a 404 with the 404 page, and only the assets that exist are cached for long", async ({ page, request }) => {
    const missing = await page.goto(MISSING_PAGE)
    expect(missing?.status()).toBe(404)
    await expect(page.getByRole("heading", { name: "404 Not Found" })).toBeVisible()
    const missingAsset = await request.get(MISSING_ASSET)
    expect(missingAsset.status()).toBe(404)
    expect(missingAsset.headers()["cache-control"]).toBe("no-cache")
    const asset = await request.get(await firstAsset(request))
    expect(asset.status()).toBe(200)
    expect(asset.headers()["cache-control"]).toContain("immutable")
  })
})
