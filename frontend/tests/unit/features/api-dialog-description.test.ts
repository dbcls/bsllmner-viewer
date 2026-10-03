import { describe, expect, it } from "vitest"

import { apiDialogDescription } from "~/features/workspace/overlays"
import { apiRequestsFor } from "~/features/workspace/view-requests"
import { DEFAULTS, TABS } from "~/lib/workspace-state"

const FIELDS = ["cell_line", "tissue", "disease"]

describe("apiDialogDescription", () => {
  it.each(TABS)("mentions the unit on the %s tab exactly when its requests have a unit", (tab) => {
    const urls = apiRequestsFor({ ...DEFAULTS, tab, unit: "bioproject" }, FIELDS)
    expect(urls.length).toBeGreaterThan(0)
    const withUnit = urls.every((url) => new URL(url, "http://localhost").searchParams.get("unit") === "bioproject")
    const withoutUnit = urls.every((url) => !new URL(url, "http://localhost").searchParams.has("unit"))
    expect(withUnit || withoutUnit).toBe(true)
    expect(apiDialogDescription(tab).includes("same unit")).toBe(withUnit)
    if (!withUnit) expect(apiDialogDescription(tab)).not.toMatch(/unit/i)
  })

  it("says Same q. on the Samples and Projects tabs", () => {
    for (const tab of ["samples", "projects"] as const) expect(apiDialogDescription(tab)).toContain("Same q.")
  })
})
