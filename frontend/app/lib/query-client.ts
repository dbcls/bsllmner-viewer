import { QueryCache, QueryClient } from "@tanstack/react-query"

import { ApiError } from "./api/client"

/** How many times a request that failed on the server or on the network is sent again. */
const RETRIES = 2

/** The longest wait, in seconds, that a `Retry-After` can make before a request is sent again. */
const MAX_WAIT_SECONDS = 3

/**
 * Whether a failed request is sent again. A refused request (4xx) is the answer to that request and does not change when
 * it is repeated, except a 429, which says that the client has too many requests in progress. A 503 for a busy api is
 * sent again after its `Retry-After`; a 503 for a query that timed out or was too large is not, since it would run the
 * same heavy query again. Other failures of the server and of the network can succeed on a second try.
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

/** How long a response that no view uses stays in the cache. */
const UNUSED_MS = 30 * 60_000

/** The digest of the dataset version that a response names, or null for a response that names none. */
const digestOf = (data: unknown): string | null => {
  if (typeof data !== "object" || data === null || !("datasetVersion" in data)) return null
  const version: unknown = data.datasetVersion
  if (typeof version !== "object" || version === null || !("digest" in version)) return null
  return typeof version.digest === "string" ? version.digest : null
}

/**
 * A client for the responses of the api. A store does not change while the api serves it, so a response stays valid for
 * as long as the page is open and the api serves the same store. When a response names another dataset version than the
 * response before it, the api serves another store, and every other response is fetched again when a view uses it, so
 * that the page does not show the results of two stores together.
 */
export const createQueryClient = (): QueryClient => {
  let digest: string | null = null
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onSuccess: (data, query) => {
        const next = digestOf(data)
        if (next === null) return
        if (digest !== null && next !== digest) void client.invalidateQueries({ predicate: (other) => other !== query })
        digest = next
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: UNUSED_MS,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
        retryDelay,
      },
    },
  })
  return client
}

export const queryClient = createQueryClient()
