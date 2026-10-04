import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { crawlRel } from "~/lib/site"

const NGINX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../nginx")

/** The lines of a robots.txt file as [directive, value], in their order. */
const rules = (name: string): [string, string][] =>
  readFileSync(path.join(NGINX, name), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const colon = line.indexOf(":")
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()]
    })

describe("robots.txt of a deployment that search engines may index", () => {
  const disallowed = rules("robots.txt").filter(([directive]) => directive === "Disallow").map(([, value]) => value)

  it("disallows only the workspace with parameters, so crawlers can still use the API and the exports", () => {
    expect(rules("robots.txt")).toEqual([
      ["User-agent", "*"],
      ["Disallow", "/entries?"],
    ])
  })

  it("marks a link nofollow exactly when robots.txt disallows its address", () => {
    const starts = ["/", "/entries", "/entries?", "/entries/", "/api", "/api/export/", "/llms.txt", ...disallowed]
    fc.assert(
      fc.property(fc.constantFrom(...starts), fc.oneof(fc.string(), fc.string({ unit: fc.constantFrom("?", "/", "=", "&", "#", "x") })), (start, rest) => {
        const to = start + rest
        expect(crawlRel(to)).toBe(disallowed.some((prefix) => to.startsWith(prefix)) ? "nofollow" : undefined)
      }),
    )
  })
})

describe("robots.txt of a deployment that search engines must not index", () => {
  it("allows only the API, llms.txt, and llms-full.txt", () => {
    expect(rules("robots.noindex.txt")).toEqual([
      ["User-agent", "*"],
      ["Allow", "/api"],
      ["Allow", "/llms.txt"],
      ["Allow", "/llms-full.txt"],
      ["Disallow", "/"],
    ])
  })
})
