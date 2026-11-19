import { useSyncExternalStore } from "react"

const subscribe = () => () => undefined

/**
 * Whether the app has taken over the HTML that the build wrote. The value is false when the build draws the HTML and in
 * the first render in the browser, which must draw what the HTML has, and true from the next render.
 */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
