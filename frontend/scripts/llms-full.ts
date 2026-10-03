// Joins docs/api.md and docs/data-model.md into the text that the site serves as /llms-full.txt.
// The web image build writes the file, and the dev server serves it from the same function.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** The files in the order that the output has them. */
export const LLMS_FULL_SOURCES = ["api.md", "data-model.md"] as const

const GITHUB_REPO_URL = "https://github.com/dbcls/bsllmner-viewer/blob/"

/** The GitHub address of docs/ at a ref: a branch name or a commit. */
export const githubDocsUrl = (ref = "main"): string => `${GITHUB_REPO_URL}${ref}/docs/`

export const GITHUB_DOCS_URL = githubDocsUrl()

const HEADER = "<!-- Generated from docs/api.md and docs/data-model.md of the repository. Do not edit. -->"

const LINK_TARGET = /\]\(([^)\s]+)\)/g

/** A link target that stays as written: an absolute URL, a path from the site root, or an anchor in the same file. */
const isKept = (target: string): boolean => /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(target)

/** The anchor that GitHub makes of a heading text, before it numbers a repeated anchor. */
export const slugOf = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-")

/** The anchors of the headings of a Markdown text, outside code fences, with GitHub's numbering of repeated anchors. */
export const headingAnchors = (markdown: string): string[] => {
  const seen = new Map<string, number>()
  const anchors: string[] = []
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = fenced ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading === null) continue
    const slug = slugOf(heading[1] ?? "")
    const n = seen.get(slug) ?? 0
    seen.set(slug, n + 1)
    anchors.push(n === 0 ? slug : `${slug}-${n}`)
  }
  return anchors
}

export type RewriteOptions = {
  /** The files that the output includes, each with the anchor of its first heading. A link to one of them becomes an anchor of the output. */
  included?: Readonly<Record<string, string>>
  /** The branch or the commit of the GitHub addresses. */
  ref?: string | undefined
}

/**
 * The text with every relative link target rewritten. A link to a file that the output includes becomes an anchor in
 * the output, and a link to another file of the repository becomes its address on GitHub.
 */
export const rewriteLinks = (markdown: string, options: RewriteOptions = {}): string =>
  markdown.replace(LINK_TARGET, (match, target: string) => {
    if (isKept(target)) return match
    const resolved = path.posix.normalize(path.posix.join("docs", target))
    if (resolved.startsWith("..")) return match
    const [file, anchor] = resolved.split("#", 2) as [string, string | undefined]
    const first = file.startsWith("docs/") ? options.included?.[file.slice("docs/".length)] : undefined
    if (first !== undefined) return `](#${anchor === undefined || anchor === "" ? first : anchor})`
    return `](${GITHUB_REPO_URL}${options.ref ?? "main"}/${resolved})`
  })

/**
 * The joined text of the sources in `docsDir`, with the links rewritten. Throws when a source is missing.
 * The `ref` of the GitHub addresses is `main` unless it is given.
 */
export const buildLlmsFull = (docsDir: string, ref?: string): string => {
  const texts = LLMS_FULL_SOURCES.map((name) => readFileSync(path.join(docsDir, name), "utf8").trim())
  const included = Object.fromEntries(LLMS_FULL_SOURCES.map((name, i) => [name, headingAnchors(texts[i] ?? "")[0] ?? ""]))
  const parts = texts.map((text) => rewriteLinks(text, { included, ref }))
  return `${HEADER}\n\n${parts.join("\n\n")}\n`
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [docsDir, outFile] = process.argv.slice(2)
  if (docsDir === undefined || outFile === undefined) throw new Error("usage: llms-full.ts <docs directory> <output file>")
  writeFileSync(outFile, buildLlmsFull(docsDir, process.env.BSLLMNER_VIEWER_COMMIT || undefined))
}
