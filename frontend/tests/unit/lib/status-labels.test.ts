import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { STATUS_INFO } from "~/lib/labels"

const OPENAPI_TYPES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../app/lib/api/openapi-types.ts")

/** The pairs of a status and its label in the sentence `The UI shows \`a\` as "A", \`b\` as "B", and \`c\` as "C".` of a status description. */
const shownNames = (description: string): Map<string, string> => {
  const sentence = /The UI shows (.*?\.)(?: |$)/.exec(description)?.[1] ?? ""
  return new Map([...sentence.matchAll(/`([a-z_]+)` as "([^"]+)"/g)].map((m) => [m[1] as string, m[2] as string]))
}

describe("status labels in the OpenAPI descriptions", () => {
  const descriptions = readFileSync(OPENAPI_TYPES, "utf8")
    .split("\n")
    .filter((line) => line.includes("@description Annotation status."))
  const expected = new Map(Object.entries(STATUS_INFO).map(([status, info]) => [status, info.label]))

  it("finds the descriptions of AnnotationValue.status and EntryAnnotation.status", () => {
    expect(descriptions).toHaveLength(2)
  })

  it("names every status of STATUS_INFO with its label in each description", () => {
    for (const description of descriptions) expect(shownNames(description)).toEqual(expected)
  })
})
