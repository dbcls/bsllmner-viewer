import createClient from "openapi-fetch"

import type { paths } from "./openapi-types"

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
}

export class ApiError extends Error {
  readonly problem: Problem

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title)
    this.problem = problem
  }
}

export const unwrap = <T>(result: { data?: T; error?: unknown; response: Response }): T => {
  if (result.data !== undefined) return result.data
  const error = result.error
  if (isProblem(error)) throw new ApiError(error)
  throw new ApiError({ type: "about:blank", title: result.response.statusText, status: result.response.status })
}

const isProblem = (value: unknown): value is Problem =>
  typeof value === "object" && value !== null && "type" in value && "status" in value && "title" in value

/** The URL of a GET request, for the API modal and for downloads. */
export const apiUrl = (path: string, params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}
