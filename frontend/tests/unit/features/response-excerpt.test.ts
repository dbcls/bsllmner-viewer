import { describe, expect, it } from "vitest"

import { responseExcerpt } from "~/features/workspace/overlays"

const DATASET_VERSION = { name: "bsllmner-mistral-all", createdAt: "2026-10-01T23:40:57Z", model: "mistral-small3.1:24b", digest: "8680d08da76ce8cf" }

describe("responseExcerpt", () => {
  it("drops the top-level datasetVersion and starts with the fields that answer the request", () => {
    const text = JSON.stringify({ datasetVersion: DATASET_VERSION, q: "a:b", total: 3 })
    const excerpt = responseExcerpt(text)
    expect(excerpt).not.toContain("datasetVersion")
    expect(excerpt).toBe(JSON.stringify({ q: "a:b", total: 3 }, null, 2))
  })

  it("keeps a datasetVersion that is not at the top level", () => {
    const body = { items: [{ datasetVersion: "x" }] }
    expect(responseExcerpt(JSON.stringify(body))).toBe(JSON.stringify(body, null, 2))
  })

  it("keeps a JSON array or scalar as it is", () => {
    expect(responseExcerpt("[1,2]")).toBe(JSON.stringify([1, 2], null, 2))
    expect(responseExcerpt("null")).toBe("null")
    expect(responseExcerpt("3")).toBe("3")
  })

  it("cuts a long JSON body at 2500 characters and marks the cut", () => {
    const body = { q: "a", items: Array.from({ length: 500 }, (_, i) => ({ identifier: `SAMN${i}` })) }
    const excerpt = responseExcerpt(JSON.stringify(body))
    expect(excerpt.endsWith("\n  …")).toBe(true)
    expect(excerpt.length).toBe(2500 + "\n  …".length)
  })

  it("does not mark a body of exactly 2500 characters as cut", () => {
    const value = "x".repeat(2500 - JSON.stringify({ q: "" }, null, 2).length)
    const excerpt = responseExcerpt(JSON.stringify({ q: value }))
    expect(excerpt.length).toBe(2500)
    expect(excerpt.endsWith("…")).toBe(false)
  })

  it("cuts a body that is not JSON without a mark", () => {
    expect(responseExcerpt("Internal Server Error")).toBe("Internal Server Error")
    expect(responseExcerpt("e".repeat(3000))).toBe("e".repeat(2500))
    expect(responseExcerpt("")).toBe("")
  })
})
