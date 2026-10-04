import { describe, expect, it } from "vitest"

import { createQueryClient } from "~/lib/query-client"

/** A response of the api that names a dataset version. */
const named = (digest: string) => ({ datasetVersion: { name: "dataset", createdAt: "2026-01-01T00:00:00Z", model: "m", digest } })

const fetchAs = (client: ReturnType<typeof createQueryClient>, key: string, data: unknown) =>
  client.fetchQuery({ queryKey: [key], queryFn: () => Promise.resolve(data) })

const invalidated = (client: ReturnType<typeof createQueryClient>, key: string) => client.getQueryState([key])?.isInvalidated

describe("createQueryClient", () => {
  it("keeps the responses while every response names the same dataset version", async () => {
    const client = createQueryClient()
    await fetchAs(client, "a", named("one"))
    await fetchAs(client, "b", named("one"))
    expect(invalidated(client, "a")).toBe(false)
    expect(invalidated(client, "b")).toBe(false)
  })

  it("fetches every other response again when a response names another dataset version", async () => {
    const client = createQueryClient()
    await fetchAs(client, "a", named("one"))
    await fetchAs(client, "b", named("one"))
    await fetchAs(client, "c", named("two"))
    expect(invalidated(client, "a")).toBe(true)
    expect(invalidated(client, "b")).toBe(true)
    expect(invalidated(client, "c")).toBe(false)
  })

  it("does not fetch the responses of the new version again", async () => {
    const client = createQueryClient()
    await fetchAs(client, "a", named("one"))
    await fetchAs(client, "b", named("two"))
    await fetchAs(client, "a", named("two"))
    expect(invalidated(client, "a")).toBe(false)
    expect(invalidated(client, "b")).toBe(false)
  })

  it("fetches again when the api serves the earlier dataset version again", async () => {
    const client = createQueryClient()
    await fetchAs(client, "a", named("one"))
    await fetchAs(client, "b", named("two"))
    await fetchAs(client, "c", named("one"))
    expect(invalidated(client, "b")).toBe(true)
  })

  it.each([null, "text", { datasetVersion: null }, { datasetVersion: { digest: 1 } }, {}])(
    "takes a response that names no dataset version (%j) as no change",
    async (data) => {
      const client = createQueryClient()
      await fetchAs(client, "a", named("one"))
      await fetchAs(client, "b", data)
      await fetchAs(client, "c", named("one"))
      expect(invalidated(client, "a")).toBe(false)
    },
  )

  it("gives every client its own dataset version, so that a response of another client does not make it fetch again", async () => {
    const one = createQueryClient()
    const two = createQueryClient()
    await fetchAs(two, "p", named("two"))
    await fetchAs(one, "a", named("one"))
    await fetchAs(two, "r", named("two"))
    expect(invalidated(two, "p")).toBe(false)
  })
})
