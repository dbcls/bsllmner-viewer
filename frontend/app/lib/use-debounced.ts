import { useEffect, useState } from "react"

/** The value, as it was `delay` milliseconds ago without a change in between. */
export const useDebounced = <T>(value: T, delay: number): T => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
