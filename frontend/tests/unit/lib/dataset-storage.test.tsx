import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

const pending = vi.hoisted(() => ({ resolve: undefined as ((body: unknown) => void) | undefined }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const GET = () =>
    new Promise((resolve) => {
      pending.resolve = (body) => resolve({ data: body, response: new Response("{}") })
    })
  return { ...original, api: { GET } }
})

import { DATASET_STORAGE_KEY, storedDataset, useDataset } from "~/lib/api/queries"

const description = (name: string) => ({
  datasetVersion: { name },
  fields: [{ name: "disease", mappedBiosampleCount: 3 }],
  targetAssays: ["RNA-Seq"],
  assays: [{ name: "RNA-Seq", biosampleCount: 5 }],
  organisms: [],
  ontologies: [{ prefix: "MONDO", name: "MONDO" }],
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)

beforeEach(() => {
  localStorage.clear()
})

describe("storedDataset", () => {
  it("gives nothing before the first visit, for text that is not JSON, and for JSON of another shape", () => {
    expect(storedDataset()).toBeUndefined()
    localStorage.setItem(DATASET_STORAGE_KEY, "{not json")
    expect(storedDataset()).toBeUndefined()
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify({ fields: "disease" }))
    expect(storedDataset()).toBeUndefined()
  })

  it("gives nothing for a description kept by an api without the counts of the whole dataset or the names of the ontologies", () => {
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify({ ...description("old"), assays: undefined }))
    expect(storedDataset()).toBeUndefined()
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify({ ...description("old"), fields: [{ name: "disease" }] }))
    expect(storedDataset()).toBeUndefined()
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify({ ...description("old"), ontologies: undefined }))
    expect(storedDataset()).toBeUndefined()
  })

  it("gives the description kept by the last visit", () => {
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(description("last")))
    expect(storedDataset()?.datasetVersion).toEqual({ name: "last" })
  })
})

describe("useDataset", () => {
  it("shows the stored description while the current one loads, then shows and keeps the current one", async () => {
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(description("last")))
    const { result } = renderHook(() => useDataset(), { wrapper })
    expect(result.current.isPlaceholderData).toBe(true)
    expect(result.current.data?.datasetVersion).toEqual({ name: "last" })
    pending.resolve?.(description("current"))
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false))
    expect(result.current.data?.datasetVersion).toEqual({ name: "current" })
    expect(storedDataset()?.datasetVersion).toEqual({ name: "current" })
  })
})
