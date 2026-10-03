import { describe, expect, it } from "vitest"

import { LABEL_LOOKUPS, resolvePasted } from "~/features/workspace/axis/axis-terms"
import { ApiError } from "~/lib/api/client"

/** A lookup that answers when the test says so, and records how many lookups are in progress at once. */
const controlledLookups = () => {
  const pending = new Map<string, { resolve: (id: string | null) => void; reject: (error: unknown) => void }>()
  const started: string[] = []
  let running = 0
  let mostRunning = 0
  const findTerm = (label: string) =>
    new Promise<string | null>((resolve, reject) => {
      started.push(label)
      running += 1
      mostRunning = Math.max(mostRunning, running)
      const done = () => {
        running -= 1
        pending.delete(label)
      }
      pending.set(label, {
        resolve: (id) => {
          done()
          resolve(id)
        },
        reject: (error) => {
          done()
          reject(error)
        },
      })
    })
  /** Let the promises that wait for a lookup run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { findTerm, pending, started, settle, mostRunning: () => mostRunning }
}

const labels = (n: number) => Array.from({ length: n }, (_, i) => `label${i}`)

describe("resolvePasted", () => {
  it(`looks up at most ${LABEL_LOOKUPS} labels at a time, and looks up every label`, async () => {
    const lookups = controlledLookups()
    const entries = labels(10)
    const result = resolvePasted(entries, true, lookups.findTerm)
    while (lookups.started.length < entries.length || lookups.pending.size > 0) {
      await lookups.settle()
      expect(lookups.pending.size).toBeLessThanOrEqual(LABEL_LOOKUPS)
      const [first] = lookups.pending.entries()
      if (first) first[1].resolve(`TERM:${first[0]}`)
    }
    expect((await result).terms).toHaveLength(entries.length)
    expect(lookups.mostRunning()).toBe(LABEL_LOOKUPS)
  })

  it("keeps the order of the entries when the lookups finish in the reverse order", async () => {
    const lookups = controlledLookups()
    const entries = ["a", "b:1", "c", "d", "e:2", "f"]
    const result = resolvePasted(entries, true, lookups.findTerm)
    while (lookups.started.length < 4 || lookups.pending.size > 0) {
      await lookups.settle()
      const last = [...lookups.pending.keys()].at(-1)
      if (last !== undefined) lookups.pending.get(last)?.resolve(`TERM:${last}`)
    }
    expect(await result).toEqual({ terms: ["TERM:a", "b:1", "TERM:c", "TERM:d", "e:2", "TERM:f"], missed: 0, rejected: 0 })
  })

  it("throws a failure of the server after the lookups in progress end, and starts no lookup after it", async () => {
    const lookups = controlledLookups()
    const entries = labels(20)
    const result = resolvePasted(entries, true, lookups.findTerm)
    await lookups.settle()
    lookups.pending.get("label0")?.reject(new ApiError({ type: "about:blank", title: "Internal Server Error", status: 500 }))
    await lookups.settle()
    const startedAtFailure = lookups.started.length
    for (const lookup of [...lookups.pending.values()]) lookup.resolve(null)
    await expect(result).rejects.toThrow(ApiError)
    expect(lookups.started.length).toBe(startedAtFailure)
    expect(startedAtFailure).toBeLessThan(entries.length)
  })

  it("counts a label that the api refuses as rejected while the other lookups go on", async () => {
    const refused = new ApiError({ type: "about:blank", title: "Unprocessable Entity", status: 422 })
    const findTerm = (label: string) => (label === "label3" ? Promise.reject(refused) : Promise.resolve(`TERM:${label}`))
    const entries = labels(9)
    const expected = entries.filter((label) => label !== "label3").map((label) => `TERM:${label}`)
    expect(await resolvePasted(entries, true, findTerm)).toEqual({ terms: expected, missed: 0, rejected: 1 })
  })
})
