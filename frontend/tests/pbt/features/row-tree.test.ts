import { fc, test } from "@fast-check/vitest"
import { describe, expect, it } from "vitest"

import { type Guide, nestedUnder, openChildren, rowGuides, type TreePlace, treePlaces, type TreeRow } from "~/features/workspace/heatmap/row-tree"

/** The depths of the rows of an axis with opened terms: each row is at most one level under the row above it. */
const depths = fc
  .array(fc.integer({ min: -3, max: 1 }), { maxLength: 30 })
  .map((steps) => steps.reduce<number[]>((rows, step) => [...rows, Math.max(0, (rows.at(-1) ?? -1) + step)], []))

const at = (guides: Guide[], level: number) => guides.find((guide) => guide.level === level)?.kind

/** Kinds whose line reaches the bottom edge of the row, and kinds whose line reaches its top edge. */
const DOWN = ["stem", "pass", "branch"]
const UP = ["pass", "branch", "last"]

describe("rowGuides", () => {
  test.prop([depths])("hangs every child term from its parent, at the level of the parent, by one line that bends to it", (rows) => {
    rowGuides(rows).forEach((guides, index) => {
      const depth = rows[index] ?? 0
      if (depth > 0) expect(["branch", "last"]).toContain(at(guides, depth - 1))
      expect(guides.filter((guide) => guide.kind === "branch" || guide.kind === "last").length).toBe(depth > 0 ? 1 : 0)
      expect(guides.every((guide) => guide.level < depth || (guide.level === depth && guide.kind === "stem"))).toBe(true)
    })
  })

  test.prop([depths])("joins the lines of adjacent rows without a gap and without a loose end", (rows) => {
    const guides = rowGuides(rows)
    guides.forEach((row, index) => {
      const below = guides[index + 1] ?? []
      for (const guide of row) {
        if (DOWN.includes(guide.kind)) expect(UP).toContain(at(below, guide.level))
      }
      for (const guide of below) {
        if (UP.includes(guide.kind)) expect(DOWN).toContain(at(row, guide.level))
      }
    })
  })

  test.prop([depths])("ends the line of a parent at its last child, and starts it under a parent whose children follow", (rows) => {
    rowGuides(rows).forEach((guides, index) => {
      const depth = rows[index] ?? 0
      const later = rows.slice(index + 1)
      const leave = later.findIndex((d) => d < depth)
      const sibling = (leave === -1 ? later : later.slice(0, leave)).includes(depth)
      if (depth > 0) expect(at(guides, depth - 1)).toBe(sibling ? "branch" : "last")
      expect(at(guides, depth) === "stem").toBe(rows[index + 1] === depth + 1)
    })
  })

  it("draws the guide lines of a parent with three children, where the second child has one child", () => {
    expect(rowGuides([0, 1, 1, 2, 1, 0])).toEqual([
      [{ level: 0, kind: "stem" }],
      [{ level: 0, kind: "branch" }],
      [{ level: 0, kind: "branch" }, { level: 1, kind: "stem" }],
      [{ level: 0, kind: "pass" }, { level: 1, kind: "last" }],
      [{ level: 0, kind: "last" }],
      [],
    ])
  })
})

/** Rows as values, with a parent among them and children of which some are rows already. */
const opening = fc
  .uniqueArray(fc.stringMatching(/^[a-z]{1,4}$/), { minLength: 1, maxLength: 12 })
  .chain((rows) =>
    fc.record({
      rows: fc.constant(rows),
      parent: fc.constantFrom(...rows),
      children: fc.uniqueArray(fc.oneof(fc.constantFrom(...rows), fc.stringMatching(/^[A-Z]{1,4}$/)), { minLength: 1, maxLength: 5 }),
    }),
  )
  .map((s) => ({ ...s, children: s.children.filter((child) => child !== s.parent) }))

describe("openChildren", () => {
  test.prop([opening])("puts the children right under the parent in their order, and keeps every other row once in its order", ({ rows, parent, children }) => {
    const opened = openChildren(rows, parent, children, (child) => [child])
    const at = opened.indexOf(parent)
    expect(opened.slice(at + 1, at + 1 + children.length)).toEqual(children)
    expect(new Set(opened).size).toBe(opened.length)
    expect(new Set(opened)).toEqual(new Set([...rows, ...children]))
    const others = rows.filter((row) => !children.includes(row))
    expect(opened.filter((row) => others.includes(row))).toEqual(others)
  })

  it("moves a child that is a row already, with the terms opened under it, to sit under the parent", () => {
    const under: Record<string, string[]> = { b: ["b1", "b2"] }
    expect(openChildren(["b", "b1", "b2", "x", "a", "y"], "a", ["b", "c"], (child) => [child, ...(under[child] ?? [])])).toEqual([
      "x",
      "a",
      "b",
      "b1",
      "b2",
      "c",
      "y",
    ])
  })
})

/** Rows with random parents among the other rows, as a list put together by hand or by a paste may have. */
const anyRows = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,3}$/), { maxLength: 15 }).chain((values) =>
  fc.tuple(
    ...values.map((value) => {
      const others = values.filter((other) => other !== value)
      return fc.subarray(others, { maxLength: Math.min(3, others.length) }).map((parents) => ({ value, parents }))
    }),
  ),
)

/** The path above row `index`: the row above it, the row that one hangs from, and so on. */
const pathAbove = (rows: TreeRow[], places: TreePlace[], index: number): string[] => {
  const path: string[] = []
  let depth = Infinity
  for (let above = index - 1; above >= 0; above -= 1) {
    const place = places[above]
    if (place && place.depth < depth) {
      path.unshift(rows[above]?.value ?? "")
      depth = place.depth
    }
  }
  return path
}

describe("treePlaces", () => {
  test.prop([anyRows])("hangs each row from the nearest of its parents on the path above it, or puts it at the top level", (rows) => {
    const places = treePlaces(rows)
    places.forEach((place, index) => {
      const path = pathAbove(rows, places, index)
      const parents = rows[index]?.parents ?? []
      const nearest = [...path].reverse().find((value) => parents.includes(value)) ?? null
      expect(place.parent).toBe(nearest)
      expect(place.depth).toBe(nearest === null ? 0 : path.indexOf(nearest) + 1)
    })
  })

  test.prop([anyRows])("goes at most one level deeper from one row to the next, so that the lines of the tree join", (rows) => {
    const depths = treePlaces(rows).map((place) => place.depth)
    depths.forEach((depth, index) => expect(depth).toBeLessThanOrEqual((depths[index - 1] ?? -1) + 1))
  })

  test.prop([anyRows, fc.nat()])("puts the children that opening a closed row adds right under it, one level deeper", (rows, pick) => {
    // Only a closed row opens: one with no rows hanging under it.
    const before = treePlaces(rows)
    const closed = rows.filter((_, index) => nestedUnder(before, index).length === 0)
    if (closed.length === 0) return
    const parent = closed[pick % closed.length]?.value ?? ""
    const children = ["X1", "X2", "X3"]
    const order = openChildren(rows.map((row) => row.value), parent, children, (child) => [child])
    const byValue = new Map(rows.map((row) => [row.value, row]))
    const opened = order.map((value) => byValue.get(value) ?? { value, parents: [parent] })
    const places = treePlaces(opened)
    const at = order.indexOf(parent)
    children.forEach((_, offset) => {
      expect(places[at + 1 + offset]).toEqual({ depth: (places[at]?.depth ?? 0) + 1, parent })
    })
    expect(nestedUnder(places, at).map((index) => order[index])).toEqual(children)
  })

  it("keeps a child above its parent at the top level, as the order of the URL puts it", () => {
    expect(treePlaces([{ value: "child", parents: ["parent"] }, { value: "parent", parents: [] }])).toEqual([
      { depth: 0, parent: null },
      { depth: 0, parent: null },
    ])
  })

  it("hangs a term with two parents from the one it follows", () => {
    const rows = [
      { value: "a", parents: [] },
      { value: "b", parents: [] },
      { value: "c", parents: ["a", "b"] },
    ]
    expect(treePlaces(rows)[2]).toEqual({ depth: 1, parent: "b" })
  })
})
