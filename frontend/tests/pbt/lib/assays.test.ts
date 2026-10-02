import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { orderAssays } from "~/lib/assays"

const name = fc.stringMatching(/^[A-Za-z][A-Za-z-]{0,9}$/)
const targets = fc.uniqueArray(name, { maxLength: 6 })

describe("orderAssays", () => {
  test.prop([fc.array(name, { maxLength: 8 }), targets])("gives the same order for every order of the same assays", (assays, targetAssays) => {
    expect(orderAssays([...assays].reverse(), targetAssays)).toEqual(orderAssays(assays, targetAssays))
  })

  test.prop([fc.array(name, { maxLength: 8 }), targets])("keeps every assay once", (assays, targetAssays) => {
    const ordered = orderAssays(assays, targetAssays)
    expect(new Set(ordered)).toEqual(new Set(assays))
    expect(ordered).toHaveLength(new Set(assays).size)
  })

  test.prop([fc.array(name, { maxLength: 8 }), targets])("puts the targets first, in their order", (assays, targetAssays) => {
    const ordered = orderAssays(assays, targetAssays)
    const targetPart = ordered.filter((assay) => targetAssays.includes(assay))
    expect(ordered.slice(0, targetPart.length)).toEqual(targetPart)
    expect(targetPart).toEqual(targetAssays.filter((assay) => assays.includes(assay)))
  })
})
