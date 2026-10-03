import { describe, expect, it } from "vitest"

import { ApiError, type Problem } from "~/lib/api/client"
import { queryClient, retryDelay, shouldRetry } from "~/lib/query-client"

const problem = (status: number, slug?: string, retryAfter: number | null = null) => {
  const body: Problem = { type: slug ? `https://example.org/problems/${slug}` : "about:blank", title: "t", status }
  return new ApiError(body, retryAfter)
}

describe("shouldRetry", () => {
  it("does not retry a 4xx response other than 429", () => {
    for (const status of [400, 404, 422, 499]) expect(shouldRetry(0, problem(status))).toBe(false)
  })

  it("retries a 429, a busy 503, any other 5xx, and a network failure at most 2 times", () => {
    for (const error of [problem(429), problem(503, "server-busy"), problem(500), problem(502), problem(503), problem(504), new TypeError("Failed to fetch")]) {
      expect(shouldRetry(0, error)).toBe(true)
      expect(shouldRetry(1, error)).toBe(true)
      expect(shouldRetry(2, error)).toBe(false)
    }
  })

  it("does not retry a 503 for a query that timed out or is too large, as the same query would be run again", () => {
    expect(shouldRetry(0, problem(503, "query-timeout"))).toBe(false)
    expect(shouldRetry(0, problem(503, "query-too-large"))).toBe(false)
  })

  it("is the retry rule of the query client", () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(shouldRetry)
    expect(queryClient.getDefaultOptions().queries?.retryDelay).toBe(retryDelay)
  })
})

describe("retryDelay", () => {
  it("waits for the Retry-After of the response, up to 3 seconds", () => {
    expect(retryDelay(0, problem(429, undefined, 1))).toBe(1000)
    expect(retryDelay(0, problem(503, "server-busy", 30))).toBe(3000)
  })

  it("backs off from 1 second when there is no Retry-After", () => {
    expect(retryDelay(0, problem(500))).toBe(1000)
    expect(retryDelay(1, new TypeError("x"))).toBe(2000)
  })
})
