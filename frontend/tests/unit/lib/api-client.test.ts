import { describe, expect, it } from "vitest"

import { ApiError, unwrap } from "~/lib/api/client"

const caught = (run: () => unknown): ApiError => {
  try {
    run()
  } catch (error) {
    if (error instanceof ApiError) return error
  }
  throw new Error("did not throw an ApiError")
}

describe("unwrap", () => {
  it("returns the data of a successful response", () => {
    expect(unwrap({ data: 0, response: new Response("{}") })).toBe(0)
  })

  it.each([
    ["2", 2],
    ["0.5", 0.5],
    ["0", null],
    ["-1", null],
    ["abc", null],
    ["Infinity", null],
    [undefined, null],
  ])("reads the Retry-After %j as a wait of %j seconds", (header, seconds) => {
    const response = new Response("{}", { status: 429, ...(header === undefined ? {} : { headers: { "Retry-After": header } }) })
    const problem = { type: "about:blank", title: "t", status: 429 }
    expect(caught(() => unwrap({ error: problem, response })).retryAfter).toBe(seconds)
  })

  it("keeps the problem of the api, and makes one from the status for a body that is not a problem", () => {
    const problem = { type: "https://example.org/problems/x", title: "t", status: 400, detail: "d" }
    expect(caught(() => unwrap({ error: problem, response: new Response("{}", { status: 400 }) })).problem).toEqual(problem)
    const bad = new Response("<html>", { status: 502, statusText: "Bad Gateway" })
    expect(caught(() => unwrap({ error: "<html>", response: bad })).problem).toEqual({ type: "about:blank", title: "Bad Gateway", status: 502 })
    expect(caught(() => unwrap({ error: { status: 502 }, response: bad })).problem).toEqual({ type: "about:blank", title: "Bad Gateway", status: 502 })
  })
})
