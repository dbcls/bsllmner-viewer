import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { wrapper } from "../query"

const pending = vi.hoisted(() => ({ resolve: undefined as ((body: unknown) => void) | undefined }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const GET = () =>
    new Promise((resolve) => {
      pending.resolve = (body) => resolve(ok(body))
    })
  return { ...original, api: { GET } }
})

import { DATASET_STORAGE_KEY, storedDataset, useDataset } from "~/lib/api/queries"

const description = (name: string) => ({
  datasetVersion: { name },
  targetAssays: ["RNA-Seq"],
  assays: [{ name: "RNA-Seq", biosampleCount: 5 }],
  organisms: [{ identifier: "9606", name: "Homo sapiens", biosampleCount: 2 }],
  ontologies: [{ prefix: "MONDO", name: "MONDO" }],
  dslFields: [{ name: "disease", kind: "term", operators: [] }],
  totals: { biosample: 5, experiment: 6, bioproject: 7 },
  fields: [{ name: "disease", multiValued: false, ontologies: ["MONDO"], mappedBiosampleCount: 3 }],
})

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

  it("gives nothing when an element of a list has another shape than the screens read", () => {
    const stored = (changed: Record<string, unknown>) => {
      localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify({ ...description("old"), ...changed }))
      return storedDataset()
    }
    expect(stored({ assays: [null] })).toBeUndefined()
    expect(stored({ assays: [{ name: "RNA-Seq" }] })).toBeUndefined()
    expect(stored({ fields: [null] })).toBeUndefined()
    expect(stored({ fields: [{ name: "disease", mappedBiosampleCount: 3 }] })).toBeUndefined()
    expect(stored({ fields: [{ name: "disease", mappedBiosampleCount: 3, ontologies: [1] }] })).toBeUndefined()
    expect(stored({ targetAssays: [1] })).toBeUndefined()
    expect(stored({ organisms: ["9606"] })).toBeUndefined()
    expect(stored({ organisms: [{ identifier: "9606", name: 1, biosampleCount: 2 }] })).toBeUndefined()
    expect(stored({ ontologies: [{ prefix: "MONDO" }] })).toBeUndefined()
    expect(stored({ dslFields: [null] })).toBeUndefined()
    expect(stored({ totals: null })).toBeUndefined()
    expect(stored({ totals: { biosample: "5" } })).toBeUndefined()
    expect(stored({ datasetVersion: null })).toBeUndefined()
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
