import "@testing-library/jest-dom/vitest"

// jsdom has no ResizeObserver. Tests that need to observe sizes stub their own.
if (typeof globalThis.ResizeObserver === "undefined") {
  const nothing = () => undefined
  globalThis.ResizeObserver = class {
    observe = nothing
    unobserve = nothing
    disconnect = nothing
  }
}
