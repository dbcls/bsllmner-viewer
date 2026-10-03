/**
 * A line in the indent of a row that ties child terms to their parent, as the tree command draws them.
 *
 * - `stem`: from the toggle of a row whose child terms follow it, down to the row's bottom edge.
 * - `pass`: through the whole row, at the level of an ancestor whose children go on below the row.
 * - `branch`: the row is a child at this level and more children of the same parent follow: the line goes through the
 *   row and bends to the row's toggle.
 * - `last`: the row is the last child at this level: the line comes down from the row's top edge and bends to its toggle.
 */
export type Guide = { level: number; kind: "stem" | "pass" | "branch" | "last" }

/**
 * The guides of each row of a tree whose rows come parent first, each child right under its parent or under an earlier
 * sibling's children, and whose depths are given in row order (0 for a term that the axis shows on its own).
 */
export const rowGuides = (depths: readonly number[]): Guide[][] => {
  // Whether, after row `index`, another child of the parent at `level` comes before the tree leaves that parent.
  const continues = (index: number, level: number): boolean => {
    for (let next = index + 1; next < depths.length; next += 1) {
      const depth = depths[next] ?? 0
      if (depth <= level) return false
      if (depth === level + 1) return true
    }
    return false
  }
  return depths.map((depth, index) => {
    const guides: Guide[] = []
    for (let level = 0; level < depth; level += 1) {
      if (level === depth - 1) guides.push({ level, kind: continues(index, level) ? "branch" : "last" })
      else if (continues(index, level)) guides.push({ level, kind: "pass" })
    }
    if ((depths[index + 1] ?? -1) === depth + 1) guides.push({ level: depth, kind: "stem" })
    return guides
  })
}

/**
 * The rows after opening `parent`: its children right under it, in their order, each followed by the terms opened under
 * it (`subtreeOf` gives a child with those terms). A child that is a row already moves there, with the terms under it,
 * so that every row stays once. The other rows keep their order.
 */
export const openChildren = (
  rows: readonly string[],
  parent: string,
  children: readonly string[],
  subtreeOf: (child: string) => string[],
): string[] => {
  const opened = [...new Set(children.flatMap(subtreeOf))].filter((value) => value !== parent)
  const moved = new Set(opened)
  const rest = rows.filter((value) => !moved.has(value))
  const at = rest.indexOf(parent)
  return [...rest.slice(0, at + 1), ...opened, ...rest.slice(at + 1)]
}

/** A row of an axis: its value, and the values of its direct parents among the other rows of the axis. */
export type TreeRow = { value: string; parents: readonly string[] }

/** Where a row sits in the tree: how deep it is, and the row that it hangs from (null at the top level). */
export type TreePlace = { depth: number; parent: string | null }

/**
 * The tree of the rows of an axis, from the rows alone, in their order. Each row hangs from the nearest of its parents on
 * the path above it: the row above, the row that one hangs from, and so on up to the top level. A row with none of its
 * parents on that path is at the top level, even when a parent of it is a row further up, so that a list that puts a
 * child away from its parent stays flat. The rows are never reordered.
 */
export const treePlaces = (rows: readonly TreeRow[]): TreePlace[] => {
  let path: string[] = []
  return rows.map((row) => {
    let level = path.length - 1
    while (level >= 0 && !row.parents.includes(path[level] ?? "")) level -= 1
    const parent = level >= 0 ? (path[level] ?? null) : null
    path = [...path.slice(0, level + 1), row.value]
    return { depth: level + 1, parent }
  })
}

/** The rows that hang under the row at `index`, at every depth: the rows after it that are deeper than it. */
export const nestedUnder = (places: readonly TreePlace[], index: number): number[] => {
  const depth = places[index]?.depth ?? 0
  const nested: number[] = []
  for (let next = index + 1; next < places.length && (places[next]?.depth ?? 0) > depth; next += 1) nested.push(next)
  return nested
}
