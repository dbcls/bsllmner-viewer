import createClient from "openapi-fetch"

import type { paths } from "./openapi-types"
import type { AccessionType, EntryType } from "./types"

/**
 * Typed client over the api. Requests go to the same origin; in development the
 * Vite dev server proxies `/api` to the api container.
 */
export const api = createClient<paths>({ baseUrl: "/" })

export type ApiPaths = paths

export type Problem = {
  type: string
  title: string
  status: number
  detail?: string
  instance?: string
  timestamp?: string
  requestId?: string
}

export class ApiError extends Error {
  readonly problem: Problem
  /** The seconds that the response asks the client to wait before it asks again (`Retry-After`), or null. */
  readonly retryAfter: number | null

  constructor(problem: Problem, retryAfter: number | null = null) {
    super(problem.detail ?? problem.title)
    this.problem = problem
    this.retryAfter = retryAfter
  }

  /** The last part of the problem type, which names the rule that the request broke, or null for `about:blank`. */
  get slug(): string | null {
    return this.problem.type === "about:blank" ? null : (this.problem.type.split("/").pop() ?? null)
  }
}

/** Whether an error is the answer of the api to a request that it refused (a 4xx response), as opposed to a failure of the server or of the network. */
export const isClientError = (error: unknown): error is ApiError => error instanceof ApiError && error.problem.status < 500

/** Whether the api refused a condition as not valid (a 400 from the parse). Any other failure of the parse says nothing about the condition. */
export const isInvalidCondition = (error: unknown): error is ApiError => error instanceof ApiError && error.problem.status === 400

/** Whether asking again can give another answer: a failure of the server or the network, or an api that is busy (429). */
export const canTryAgain = (error: unknown): boolean => !isClientError(error) || error.problem.status === 429

/** Whether the detail of the api says what to change: a refused request (not a 429), and a query that timed out or was too large. */
const detailHelps = (error: unknown): error is ApiError =>
  error instanceof ApiError && ((error.problem.status < 500 && error.problem.status !== 429) || error.slug === "query-timeout" || error.slug === "query-too-large")

/**
 * The sentence for a request that failed: "Could not <action>." and, when the detail of the api says what to change,
 * "Could not <action>: <detail>".
 */
export const failureSentence = (error: unknown, action: string): string =>
  detailHelps(error) && error.problem.detail ? `Could not ${action}: ${error.problem.detail}` : `Could not ${action}.`

/**
 * The props of the notice that replaces the content of a view whose request failed (`ErrorNotice`): the sentence, and a
 * retry button if sending the request again can succeed. A request that the api refused says what to change and has no
 * retry button. `name` is added to the accessible name of the retry button, so that it differs from the retry buttons
 * of other notices on the screen.
 */
export const loadFailureProps = (error: unknown, action: string, onRetry: () => void, name?: string) => ({
  message: failureSentence(error, action),
  ...(canTryAgain(error) ? { onRetry } : {}),
  ...(canTryAgain(error) && name ? { retryName: name } : {}),
})

/**
 * What to tell the user about a failed request. A response that the api refused (4xx) carries a detail that says what to
 * fix. A failure of the server or of the network does not, and the browser's own text for it is not shown.
 */
export const failureMessage = (error: unknown, operation: string): string =>
  isClientError(error) && error.problem.detail ? error.problem.detail : `Could not ${operation}.`

export const unwrap = <T>(result: { data?: T; error?: unknown; response: Response }): T => {
  if (result.data !== undefined) return result.data
  const error = result.error
  const wait = Number(result.response.headers?.get("Retry-After"))
  const retryAfter = Number.isFinite(wait) && wait > 0 ? wait : null
  if (isProblem(error)) throw new ApiError(error, retryAfter)
  throw new ApiError({ type: "about:blank", title: result.response.statusText, status: result.response.status }, retryAfter)
}

const isProblem = (value: unknown): value is Problem =>
  typeof value === "object" && value !== null && "type" in value && "status" in value && "title" in value

/** The api path that exports every entry of a type matching the condition. */
export const exportEntriesUrl = (type: EntryType, q: string | null, format: "tsv" | "ndjson"): string =>
  apiUrl(`/api/export/entries/${type}`, { q: q ?? undefined, format })

/** The api path that lists the accessions of a type matching the condition. */
export const exportAccessionsUrl = (type: AccessionType, q: string | null): string =>
  apiUrl(`/api/export/accessions/${type}`, { q: q ?? undefined })

/** The URL of a GET request, for the API modal and for downloads. */
export const apiUrl = (path: string, params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}
