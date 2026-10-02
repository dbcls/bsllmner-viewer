import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { buildCommit } from "~/lib/build-info"

const blank = fc.stringMatching(/^[ \t\n]*$/)
const hash = fc.stringMatching(/^[0-9a-f]{7,40}$/)

describe("buildCommit", () => {
  test.prop([blank])("returns null when the build was given no commit or only white space", (value) => {
    expect(buildCommit(value)).toBeNull()
  })

  test.prop([hash, blank, blank])("returns the commit without the white space around it", (commit, before, after) => {
    expect(buildCommit(`${before}${commit}${after}`)).toBe(commit)
  })
})
