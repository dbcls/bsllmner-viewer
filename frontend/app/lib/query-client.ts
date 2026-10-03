import { QueryClient } from "@tanstack/react-query"

import { ApiError } from "./api/client"

/** How many times a request that failed on the server or on the network is sent again. */
const RETRIES = 2

/** The longest wait, in seconds, that a `Retry-After` can make before a request is sent again. */
const MAX_WAIT_SECONDS = 3

/**
 * Whether a failed request is sent again. A refused request (4xx) is the answer to that request and does not change when
 * it is repeated, except a 429, which says that the client has too many requests in progress. A 503 for a busy api is
 * sent again after its `Retry-After`; a 503 for a query that timed out or was too large is not, since it would run the
 * same heavy query again. Other failures of the server and of the network can pass.
 */
export const shouldRetry = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= RETRIES) return false
  if (!(error instanceof ApiError)) return true
  if (error.problem.status === 429 || error.slug === "server-busy") return true
  if (error.slug === "query-timeout" || error.slug === "query-too-large") return false
  return error.problem.status >= 500
}

/** How long to wait before the next try: the `Retry-After` of the response, up to a few seconds, or 1 second and then 2. */
export const retryDelay = (failureCount: number, error: unknown): number =>
  error instanceof ApiError && error.retryAfter !== null ? Math.min(error.retryAfter, MAX_WAIT_SECONDS) * 1000 : 1000 * 2 ** failureCount

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: shouldRetry,
      retryDelay,
    },
  },
})
