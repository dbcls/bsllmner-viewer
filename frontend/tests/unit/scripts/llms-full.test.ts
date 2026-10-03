import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import fc from "fast-check"
import { afterEach, describe, expect, it } from "vitest"

import { buildLlmsFull, GITHUB_DOCS_URL, githubDocsUrl, headingAnchors, rewriteLinks } from "../../../scripts/llms-full.ts"

const ROOT = "https://github.com/dbcls/bsllmner-viewer/blob/main/"

// docs/ of the repository, or /docs in the container where /app is frontend/.
const REAL_DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs")

const made: string[] = []

const docsWith = (files: Record<string, string>): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "llms-full-"))
  made.push(dir)
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text)
  return dir
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("rewriteLinks", () => {
  it("rewrites a link to another file of docs to its GitHub address and keeps the anchor", () => {
    expect(rewriteLinks("see [build.md](build.md#runs) and [x](provenance.md)")).toBe(
      `see [build.md](${GITHUB_DOCS_URL}build.md#runs) and [x](${GITHUB_DOCS_URL}provenance.md)`,
    )
  })

  it("keeps an anchor in the same file, an absolute URL, and a path from the site root", () => {
    const text = "[a](#limits) [b](https://example.org/x.md) [c](/llms.txt) [d](mailto:x@example.org)"
    expect(rewriteLinks(text)).toBe(text)
  })

  it("resolves a link to the parent directory against the repository root", () => {
    expect(rewriteLinks("[license](../LICENSE)")).toBe(`[license](${ROOT}LICENSE)`)
  })

  it("keeps a link that leaves the repository", () => {
    expect(rewriteLinks("[x](../../outside.md)")).toBe("[x](../../outside.md)")
  })

  it("does not touch a target without a link text in brackets", () => {
    expect(rewriteLinks("(build.md) and [build.md] stay")).toBe("(build.md) and [build.md] stay")
  })

  it("leaves no relative link target after rewriting any file name and anchor", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z][a-z-]{0,12}\.md$/), fc.stringMatching(/^[a-z-]{0,12}$/), (file, anchor) => {
        const target = anchor === "" ? file : `${file}#${anchor}`
        const out = rewriteLinks(`[t](${target})`)
        expect(out).toBe(`[t](${GITHUB_DOCS_URL}${target})`)
        expect(rewriteLinks(out)).toBe(out)
      }),
    )
  })
})

describe("rewriteLinks with included files", () => {
  const included = { "api.md": "api", "data-model.md": "data-model" }

  it("turns a link to an included file with an anchor into the anchor", () => {
    expect(rewriteLinks("[x](data-model.md#term-hierarchy) [y](api.md#limits)", { included })).toBe(
      "[x](#term-hierarchy) [y](#limits)",
    )
  })

  it("turns a link to an included file without an anchor into the first heading of the file", () => {
    expect(rewriteLinks("[x](data-model.md) [y](api.md)", { included })).toBe("[x](#data-model) [y](#api)")
  })

  it("keeps a link to a file that is not included as a GitHub address", () => {
    expect(rewriteLinks("[x](build.md#runs) [y](operations.md#limits-of-a-worker)", { included })).toBe(
      `[x](${GITHUB_DOCS_URL}build.md#runs) [y](${GITHUB_DOCS_URL}operations.md#limits-of-a-worker)`,
    )
  })

  it("names the given ref in the GitHub addresses", () => {
    expect(rewriteLinks("[x](build.md#runs) [l](../LICENSE)", { included, ref: "abc1234" })).toBe(
      "[x](https://github.com/dbcls/bsllmner-viewer/blob/abc1234/docs/build.md#runs) " +
        "[l](https://github.com/dbcls/bsllmner-viewer/blob/abc1234/LICENSE)",
    )
    expect(githubDocsUrl("abc1234")).toBe("https://github.com/dbcls/bsllmner-viewer/blob/abc1234/docs/")
  })

  it("resolves a link with a parent directory to an included file", () => {
    expect(rewriteLinks("[x](../docs/api.md#limits)", { included })).toBe("[x](#limits)")
  })

  it("does not match a file whose name only ends like an included file", () => {
    expect(rewriteLinks("[x](old-api.md#a)", { included })).toBe(`[x](${GITHUB_DOCS_URL}old-api.md#a)`)
  })
})

describe("headingAnchors", () => {
  it("makes GitHub anchors: lower case, no punctuation, hyphens for spaces", () => {
    expect(headingAnchors("# API\n\n## Self-exclusion\n\n### Expected counts in `cross-tabulations`?\n")).toEqual([
      "api",
      "self-exclusion",
      "expected-counts-in-cross-tabulations",
    ])
  })

  it("numbers a repeated anchor", () => {
    expect(headingAnchors("## Limits\n## Limits\n## Limits\n")).toEqual(["limits", "limits-1", "limits-2"])
  })

  it("skips a line that looks like a heading in a code fence", () => {
    expect(headingAnchors("# A\n```\n# not a heading\n```\n## B\n")).toEqual(["a", "b"])
  })

  it("does not take a line without a space after the hashes", () => {
    expect(headingAnchors("#tag\n####### seven\n")).toEqual([])
  })
})

describe("buildLlmsFull", () => {
  it("joins api.md and then data-model.md with the links rewritten", () => {
    const dir = docsWith({
      "api.md": "# API\n\nsee [data model](data-model.md#counting)\n",
      "data-model.md": "# Data Model\n\nsee [api](api.md#limits)\n",
    })
    const out = buildLlmsFull(dir)
    expect(out.indexOf("# API")).toBeGreaterThan(-1)
    expect(out.indexOf("# API")).toBeLessThan(out.indexOf("# Data Model"))
    expect(out).toContain("[data model](#counting)")
    expect(out).toContain("[api](#limits)")
    expect(out.startsWith("<!--")).toBe(true)
    expect(out.endsWith("\n")).toBe(true)
  })

  it("links to a file of docs that is not joined with the given ref", () => {
    const dir = docsWith({ "api.md": "# API\n\n[b](build.md#runs)\n", "data-model.md": "# Data Model\n\n[d](api.md)\n" })
    const out = buildLlmsFull(dir, "abc1234")
    expect(out).toContain("[b](https://github.com/dbcls/bsllmner-viewer/blob/abc1234/docs/build.md#runs)")
    expect(out).toContain("[d](#api)")
    expect(buildLlmsFull(dir)).toContain(`[b](${GITHUB_DOCS_URL}build.md#runs)`)
  })

  it("fails when one of the two files is missing", () => {
    expect(() => buildLlmsFull(docsWith({ "api.md": "# API\n" }))).toThrow()
    expect(() => buildLlmsFull(docsWith({ "data-model.md": "# Data Model\n" }))).toThrow()
  })

  it.skipIf(!existsSync(path.join(REAL_DOCS, "api.md")))("contains both real documents and no relative link", () => {
    const out = buildLlmsFull(REAL_DOCS)
    expect(out).toContain("\n# API\n")
    expect(out).toContain("\n# Data Model\n")
    for (const [, target] of out.matchAll(/\]\(([^)\s]+)\)/g)) {
      expect(target, target).toMatch(/^(https?:|\/|#)/)
    }
  })

  it.skipIf(!existsSync(path.join(REAL_DOCS, "api.md")))("has a heading for every anchor link of the real documents", () => {
    const out = buildLlmsFull(REAL_DOCS)
    const anchors = new Set(headingAnchors(out))
    const links = [...out.matchAll(/\]\(#([^)\s]*)\)/g)].map((m) => m[1] ?? "")
    expect(links.length).toBeGreaterThan(10)
    for (const anchor of links) expect(anchors.has(anchor), `#${anchor}`).toBe(true)
  })

  it.skipIf(!existsSync(path.join(REAL_DOCS, "api.md")))("links the two documents to each other inside the file", () => {
    const out = buildLlmsFull(REAL_DOCS)
    expect(out).toContain("](#term-hierarchy)")
    expect(out).not.toMatch(/\]\(https:\/\/github\.com[^)]*\/docs\/(api|data-model)\.md/)
  })

  it("detects an anchor link without a heading", () => {
    const dir = docsWith({ "api.md": "# API\n\n[x](data-model.md#nonexistent)\n", "data-model.md": "# Data Model\n" })
    const out = buildLlmsFull(dir)
    const anchors = new Set(headingAnchors(out))
    expect(anchors.has("nonexistent")).toBe(false)
    expect(out).toContain("[x](#nonexistent)")
  })
})
