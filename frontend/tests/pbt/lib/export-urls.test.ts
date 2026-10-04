import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { exportAccessionsUrl, exportEntriesUrl } from "~/lib/api/client"

describe("export URLs", () => {
  const condition = fc.oneof(fc.string(), fc.string({ unit: "grapheme" }))
  const read = (url: string) => new URL(url, "http://localhost").searchParams

  test.prop([condition])("carry a condition that reads back as the same condition, and no q for an empty condition", (q) => {
    const entries = read(exportEntriesUrl("biosample", q, "tsv"))
    const accessions = read(exportAccessionsUrl("sra-run", q))
    expect(entries.get("q")).toBe(q === "" ? null : q)
    expect(accessions.get("q")).toBe(q === "" ? null : q)
    expect(entries.get("format")).toBe("tsv")
  })
})
