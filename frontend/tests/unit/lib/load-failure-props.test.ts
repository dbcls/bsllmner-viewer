import { describe, expect, it, vi } from "vitest"

import { ApiError, loadFailureProps } from "~/lib/api/client"

const refused = (status: number, detail?: string) => new ApiError({ type: "about:blank", title: "t", status, ...(detail ? { detail } : {}) })

describe("loadFailureProps", () => {
  const retry = vi.fn()

  it("gives the detail of a refused request and no retry", () => {
    const props = loadFailureProps(refused(400, "too many"), "load the heatmap", retry)
    expect(props).toEqual({ message: "Could not load the heatmap: too many" })
  })

  it("gives a retry, named when a name is given, for a failure of the server, the network, or a busy api", () => {
    for (const error of [refused(500), refused(429), new TypeError("Failed to fetch")]) {
      const props = loadFailureProps(error, "load the trend", retry, "trend")
      expect(props).toEqual({ message: "Could not load the trend.", onRetry: retry, retryName: "trend" })
    }
  })
})
