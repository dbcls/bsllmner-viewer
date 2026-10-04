import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import fc from "fast-check"
import { afterEach, describe, expect, it } from "vitest"

import { apiRequestsFor } from "~/features/workspace/view-requests"
import { DEFAULTS, readState, type Tab, TABS, type WorkspaceState, writeState } from "~/lib/workspace-state"

import { buildLlmsFull, GITHUB_DOCS_URL, githubDocsUrl, headingAnchors, rewriteLinks } from "../../../scripts/llms-full.ts"

const ROOT = "https://github.com/dbcls/bsllmner-viewer/blob/main/"

// docs/ of the repository, or /docs in the container where /app is frontend/.
const REAL_DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs")

const LLMS_TXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public/llms.txt")

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

  it("contains both real documents and no relative link", () => {
    const out = buildLlmsFull(REAL_DOCS)
    expect(out).toContain("\n# API\n")
    expect(out).toContain("\n# Data Model\n")
    for (const [, target] of out.matchAll(/\]\(([^)\s]+)\)/g)) {
      expect(target, target).toMatch(/^(https?:|\/|#)/)
    }
  })

  it("has a heading for every anchor link of the real documents", () => {
    const out = buildLlmsFull(REAL_DOCS)
    const anchors = new Set(headingAnchors(out))
    const links = [...out.matchAll(/\]\(#([^)\s]*)\)/g)].map((m) => m[1] ?? "")
    expect(links.length).toBeGreaterThan(10)
    for (const anchor of links) expect(anchors.has(anchor), `#${anchor}`).toBe(true)
  })

  it("links the two documents to each other inside the file", () => {
    const out = buildLlmsFull(REAL_DOCS)
    expect(out).toContain("](#term-hierarchy)")
    expect(out).not.toMatch(/\]\(https:\/\/github\.com[^)]*\/docs\/(api|data-model)\.md/)
  })
})

describe("llms.txt", () => {
  const llms = readFileSync(LLMS_TXT, "utf8")

  /** Annotation fields of a dataset, enough for every default axis of the UI. */
  const FIELDS = ["cell_line", "tissue", "disease"]

  /** The recipe whose name starts the line. */
  const recipe = (name: string): string => llms.split("\n").find((line) => line.startsWith(`- ${name}:`)) ?? ""

  /** The pairs that a recipe writes as "`a` is `b`". */
  const pairs = (line: string): [string, string][] => [...line.matchAll(/`([^`]+)` is `([^`]+)`/g)].map((m) => [m[1] ?? "", m[2] ?? ""])

  const isTab = (value: string): value is Tab => (TABS as readonly string[]).includes(value)

  /** The path and the query parameters of the first api request that the UI makes for a view. */
  const requestOf = (state: WorkspaceState): { path: string; params: URLSearchParams } => {
    const [path = "", search = ""] = (apiRequestsFor(state, FIELDS)[0] ?? "").split("?")
    return { path, params: new URLSearchParams(search) }
  }

  it("names only headings that llms-full.txt has, with the same text", () => {
    const headings = new Set([...buildLlmsFull(REAL_DOCS).matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => m[1]))
    const named = [...llms.matchAll(/See "([^"]+)"/g)].map((m) => m[1] ?? "")
    expect(named.length).toBeGreaterThan(5)
    for (const heading of named) expect(headings.has(heading), heading).toBe(true)
  })

  it("maps every tab of a workspace URL to the operation that the UI calls for it, and names the tab of a URL without one", () => {
    const line = recipe("Get the same numbers as the UI")
    const operations = pairs(line).filter(([, operation]) => operation.startsWith("GET "))
    expect(operations.map(([tab]) => tab).toSorted()).toEqual([...TABS].toSorted())
    for (const [tab, operation] of operations) {
      if (!isTab(tab)) throw new Error(`not a tab: ${tab}`)
      expect(`GET ${requestOf({ ...DEFAULTS, tab }).path}`, tab).toBe(operation)
    }
    expect(line).toContain(`A URL without \`tab\` shows \`${DEFAULTS.tab}\`.`)
  })

  it("names defaults that the UI does not write to a URL and that the UI sends to the API for the named tabs", () => {
    const line = recipe("Read the other parameters of a URL of the UI")
    const renamed = new Map(pairs(line))
    const groups = (/so send them: (.+?)\. /.exec(line)?.[1] ?? "").split(/, (?:and )?/)
    expect(groups.length).toBeGreaterThanOrEqual(3)
    for (const group of groups) {
      const [, values = "", tabs = ""] = /^(.*) for (.*)$/.exec(group) ?? []
      const defaults = [...values.matchAll(/`([A-Za-z_]+)=([^`]+)`/g)].map((m) => [m[1] ?? "", m[2] ?? ""] as const)
      const named = [...tabs.matchAll(/`([a-z]+)`/g)].map((m) => m[1] ?? "")
      expect(defaults.length * named.length, group).toBeGreaterThan(0)
      for (const tab of named) {
        if (!isTab(tab)) throw new Error(`not a tab: ${tab}`)
        for (const [name, value] of defaults) {
          expect(writeState({ ...DEFAULTS, tab }).has(name), `${tab}: ${name}`).toBe(false)
          expect(requestOf({ ...DEFAULTS, tab }).params.get(renamed.get(name) ?? name), `${tab}: ${name}`).toBe(value)
        }
      }
    }
  })

  it("gives the API name of each URL parameter in every request that the parameter changes", () => {
    const line = recipe("Read the other parameters of a URL of the UI")
    const state: WorkspaceState = {
      ...DEFAULTS,
      unit: "bioproject",
      page: 2,
      perPage: 50,
      sort: "experimentCount:asc",
      row: "tissue",
      col: "disease",
      rowTerms: ["UBERON:0000955"],
      colTerms: ["MONDO:0007254"],
      trendField: "tissue",
      trendTerms: ["UBERON:0002107"],
      trendFrom: 2015,
      trendTo: 2020,
    }
    const url = writeState(state)
    const kept = [...(/such as (.+?), have the same names/.exec(line)?.[1] ?? "").matchAll(/`([A-Za-z_]+)`/g)].map((m) => m[1] ?? "")
    const names = [...pairs(line), ...kept.map((name): [string, string] => [name, name])]
    expect(names.length).toBeGreaterThan(6)
    for (const [urlName, apiName] of names) {
      expect(url.get(urlName), urlName).not.toBeNull()
      const without = new URLSearchParams(url)
      without.delete(urlName)
      const tabs = TABS.filter((tab) => requestOf({ ...readState(url), tab }).params.toString() !== requestOf({ ...readState(without), tab }).params.toString())
      expect(tabs.length, urlName).toBeGreaterThan(0)
      for (const tab of tabs) {
        expect(requestOf({ ...readState(url), tab }).params.get(apiName), `${tab}: ${urlName} is ${apiName}`).toBe(url.get(urlName))
      }
    }
  })
})

describe("llms-full.ts as a command", () => {
  const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/llms-full.ts")

  const runWith = (commit: string | undefined): string => {
    const docs = docsWith({ "api.md": "# API\n\nsee [build](build.md)\n", "data-model.md": "# Data model\n" })
    const out = path.join(docs, "out.txt")
    const env = { ...process.env }
    delete env.BSLLMNER_VIEWER_COMMIT
    if (commit !== undefined) env.BSLLMNER_VIEWER_COMMIT = commit
    execFileSync(process.execPath, [SCRIPT, docs, out], { env })
    return readFileSync(out, "utf8")
  }

  it("points the GitHub addresses at main when BSLLMNER_VIEWER_COMMIT is empty or not set", () => {
    for (const commit of [undefined, ""]) {
      const text = runWith(commit)
      expect(text).toContain("](https://github.com/dbcls/bsllmner-viewer/blob/main/docs/build.md)")
    }
  })

  it("points the GitHub addresses at the commit when BSLLMNER_VIEWER_COMMIT is set", () => {
    const commit = "0123456789abcdef0123456789abcdef01234567"
    const text = runWith(commit)
    expect(text).toContain(`](https://github.com/dbcls/bsllmner-viewer/blob/${commit}/docs/build.md)`)
    expect(text).not.toContain("/blob/main/")
  })
})
