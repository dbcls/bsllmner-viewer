import "@testing-library/jest-dom/vitest"

import { afterEach, vi } from "vitest"

// jsdom has no ResizeObserver. Tests that need to observe sizes stub their own.
// The default is assigned directly, not with vi.stubGlobal, so that unstubAllGlobals does not remove it.
if (typeof globalThis.ResizeObserver === "undefined") {
  const nothing = () => undefined
  globalThis.ResizeObserver = class {
    observe = nothing
    unobserve = nothing
    disconnect = nothing
  }
}

// A global that a test stubs does not reach the next test.
afterEach(() => {
  vi.unstubAllGlobals()
})
