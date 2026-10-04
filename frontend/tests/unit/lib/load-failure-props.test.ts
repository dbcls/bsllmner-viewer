import { describe, expect, it, vi } from "vitest"

import { ApiError, failureMessage, loadFailureProps } from "~/lib/api/client"

const refused = (status: number, detail?: string, slug?: string) =>
  new ApiError({ type: slug ? `https://example.org/problems/${slug}` : "about:blank", title: "t", status, ...(detail ? { detail } : {}) })

describe("loadFailureProps", () => {
  const retry = vi.fn()

  it.each([
    ["a refused request", refused(404), "Could not load X.", false],
    ["a refused request with a detail", refused(400, "too many"), "Could not load X: too many", false],
    ["a 429 with a detail", refused(429, "slow"), "Could not load X.", true],
    ["a query that timed out", refused(503, "took long", "query-timeout"), "Could not load X: took long", true],
    ["a query that is too large", refused(503, "too large", "query-too-large"), "Could not load X: too large", true],
    ["a busy server", refused(503, "busy", "server-busy"), "Could not load X.", true],
    ["a failure of the server with a detail", refused(500, "boom"), "Could not load X.", true],
    ["a failure of the network", new TypeError("Failed to fetch"), "Could not load X.", true],
  ])("gives the sentence, and a retry named after the view where the request can be sent again, for %s", (_name, error, message, canRetry) => {
    expect(loadFailureProps(error, "load X", retry, "x")).toStrictEqual(canRetry ? { message, onRetry: retry, retryName: "x" } : { message })
  })

  it("names no retry button when no name is given", () => {
    expect(loadFailureProps(refused(500), "load X", retry)).toStrictEqual({ message: "Could not load X.", onRetry: retry })
  })
})

describe("failureMessage", () => {
  it("gives the detail of a refused request only", () => {
    expect(failureMessage(refused(400, "bad"), "load X")).toBe("bad")
    expect(failureMessage(refused(500, "boom"), "load X")).toBe("Could not load X.")
    expect(failureMessage(new TypeError("Failed to fetch"), "load X")).toBe("Could not load X.")
  })
})
