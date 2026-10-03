import { expect, test } from "@playwright/test"

import { get } from "./_api"

type OpenApi = { info: { description: string }; paths: Record<string, unknown> }

/** The condition examples of llms.txt: the code at the start of each bullet under "Conditions". */
const conditionExamples = (llms: string): string[] => {
  const section = llms.split(/^## /m).find((part) => part.startsWith("Conditions")) ?? ""
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1] as string)
}

/** The pages of the api that are not operations. */
const PAGES = new Set(["/api", "/api/redoc", "/api/openapi.json"])

/** The operation paths under /api that llms.txt names, without the query string. */
const apiPaths = (llms: string): string[] => [
  ...new Set([...llms.matchAll(/\/api(?:\/[A-Za-z0-9_{}.-]+)*/g)].map((match) => match[0]).filter((path) => !PAGES.has(path))),
]

/** Whether an OpenAPI path template, such as /api/export/accessions/{type}, matches a path of llms.txt. */
const matches = (template: string, candidate: string): boolean =>
  new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`).test(candidate)

test.describe("llms.txt and llms-full.txt", () => {
  test("llms.txt and llms-full.txt are served as Markdown", async ({ request }) => {
    for (const path of ["/llms.txt", "/llms-full.txt"]) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(200)
      expect(response.headers()["content-type"], path).toContain("text/markdown")
    }
    const full = await (await request.get("/llms-full.txt")).text()
    expect(full).toContain("\n# API\n")
    expect(full).toContain("\n# Data Model\n")
  })

  test("llms-full.txt has no relative link", async ({ request }) => {
    const full = await (await request.get("/llms-full.txt")).text()
    for (const [, target] of full.matchAll(/\]\(([^)\s]+)\)/g)) expect(target, String(target)).toMatch(/^(https?:|\/|#)/)
  })

  test("every API path in llms.txt is in the OpenAPI document", async ({ request }) => {
    const llms = await (await request.get("/llms.txt")).text()
    const openapi = await get<OpenApi>(request, "/api/openapi.json")
    const paths = apiPaths(llms)
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect(Object.keys(openapi.paths).some((template) => matches(template, path)), path).toBe(true)
    }
  })

  test("the OpenAPI document links llms.txt and llms-full.txt", async ({ request }) => {
    const openapi = await get<OpenApi>(request, "/api/openapi.json")
    expect(openapi.info.description).toContain("](/llms.txt)")
    expect(openapi.info.description).toContain("](/llms-full.txt)")
  })

  test("every condition example in llms.txt parses", async ({ request }) => {
    const examples = conditionExamples(await (await request.get("/llms.txt")).text())
    expect(examples.length).toBeGreaterThanOrEqual(4)
    for (const q of examples) {
      const parsed = await get<{ ast: unknown }>(request, "/api/dsl/parse", { q })
      expect(parsed.ast, q).toBeTruthy()
    }
  })
})
