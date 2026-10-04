import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const TYPES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../app/lib/api/types.ts")

/** The right side of an alias must start from `components`, `operations`, `paths`, or `Schemas` (an alias of `components["schemas"]`). */
const GENERATED_ROOT = /^(?:components|operations|paths|Schemas)\b/

describe("API types", () => {
  const source = readFileSync(TYPES, "utf8")
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const exports = [...withoutComments.matchAll(/^export\s+(.*)$/gm)].map((match) => match[1] as string)

  it("exports types only", () => {
    expect(exports.length).toBeGreaterThan(10)
    for (const line of exports) expect(line, line).toMatch(/^type\s+\w+\s*=/)
  })

  it("defines every exported type as an alias of the generated OpenAPI types", () => {
    for (const line of exports) {
      const right = /^type\s+\w+\s*=\s*(.*)$/.exec(line)?.[1] ?? ""
      expect(right, line).toMatch(GENERATED_ROOT)
    }
  })

  it("defines Schemas as an alias of the schemas of the generated components", () => {
    expect(withoutComments).toMatch(/^type Schemas = components\["schemas"\]$/m)
  })

  it("imports only from the generated file and declares no other type", () => {
    expect(withoutComments).toMatch(/^import type \{ components, operations \} from "\.\/openapi-types"$/m)
    const declarations = [...withoutComments.matchAll(/^(?:export\s+)?(?:interface|enum|class|const|function|let|var)\b.*$/gm)]
    expect(declarations.map((match) => match[0])).toEqual([])
    const types = [...withoutComments.matchAll(/^(?:export\s+)?type\s+\w+/gm)]
    const aliased = [...withoutComments.matchAll(/^(?:export\s+)?type\s+\w+\s*=\s*(?:components|operations|paths|Schemas)\b/gm)]
    expect(types.length).toBe(aliased.length)
  })
})
