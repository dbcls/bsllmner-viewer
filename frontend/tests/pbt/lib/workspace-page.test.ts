import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { readState } from "~/lib/workspace-state"

describe("readState page", () => {
  test.prop([fc.string()])("is always a safe positive integer", (text) => {
    const page = readState(new URLSearchParams({ page: text })).page
    expect(Number.isSafeInteger(page) && page >= 1).toBe(true)
  })

  test.prop([fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER })])("reads the digits of a safe integer as that page", (n) => {
    expect(readState(new URLSearchParams({ page: String(n) })).page).toBe(n)
  })
})
