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

// The tests do not load the stylesheet of the app. The `sr-only` class of Tailwind positions an element absolutely. A
// browser computes the display of an absolutely positioned element as block, so an accessible name has a space before
// the hidden text of the element. jsdom does not change the display of an absolutely positioned element, so the rule
// gives the display directly. A test that runs in the node environment has no document.
if (typeof document !== "undefined") {
  const srOnly = document.createElement("style")
  srOnly.textContent = ".sr-only { position: absolute; display: block; }"
  document.head.append(srOnly)
}

// A global that a test stubs does not reach the next test.
afterEach(() => {
  vi.unstubAllGlobals()
})
