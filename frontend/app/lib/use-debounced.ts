import { useEffect, useState } from "react"

/**
 * The latest value that has stayed the same for `delay` milliseconds. The first value is returned at once. While the
 * value keeps changing, the previous result is returned.
 */
export const useDebounced = <T>(value: T, delay: number): T => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
