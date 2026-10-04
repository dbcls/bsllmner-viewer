import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../app")

/** The source files of the app, as paths relative to the app directory. The generated API types are not source of the app. */
const sources = (dir = APP): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return /\.tsx?$/.test(entry.name) && entry.name !== "openapi-types.ts" ? [path.relative(APP, full)] : []
  })

/** The code of a file without comments, with the line number of each line. */
const code = (file: string): { line: number; text: string }[] =>
  readFileSync(path.join(APP, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .split("\n")
    .map((text, index) => ({ line: index + 1, text: text.replace(/(^|\s)\/\/.*$/, "") }))

/** The text of the call that starts at `from`, up to the matching parenthesis. */
const callText = (text: string, from: number): string => {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    if (text[i] === "(") depth++
    if (text[i] === ")" && --depth === 0) return text.slice(from, i + 1)
  }
  return text.slice(from)
}

describe("the source of the app", () => {
  it("is found", () => {
    expect(sources().length).toBeGreaterThan(50)
    expect(sources()).toContain("features/workspace/use-condition.ts")
  })

  it("does not write a condition with AND, OR, or NOT in a string", () => {
    // The listed files write the words for the user to read: the example conditions, the description of an AST of the api, and the labels of the condition bar.
    const display = new Set(["lib/presets.ts", "features/workspace/ast.ts", "features/workspace/condition-bar.tsx"])
    const found = sources()
      .filter((file) => !display.has(file))
      .flatMap((file) => code(file).filter(({ text }) => /["'`][^"'`]*(\b(AND|OR) | (AND|OR)\b|\bNOT )[^"'`]*["'`]/.test(text)).map(({ line }) => `${file}:${line}`))
    expect(found).toEqual([])
  })

  it("reads and writes the q parameter of the URL only in workspace-state", () => {
    const found = sources()
      .filter((file) => file !== "lib/workspace-state.ts")
      .flatMap((file) => code(file).filter(({ text }) => /(get|set|append|delete|has)\(\s*["']q["']/.test(text)).map(({ line }) => `${file}:${line}`))
    expect(found).toEqual([])
  })

  it("does not build the q parameter of a URL as text or as a member of URLSearchParams outside workspace-state", () => {
    // No other file writes `?q=` or `&q=` in a string or a template, or a `q` member in the object of `new URLSearchParams(`.
    const found = sources()
      .filter((file) => file !== "lib/workspace-state.ts")
      .flatMap((file) => {
        const lines = code(file)
        const text = lines.map((line) => line.text).join("\n")
        const inText = lines.filter((line) => /["'`][^"'`]*[?&]q=/.test(line.text)).map(({ line }) => `${file}:${line}`)
        const inObject = [...text.matchAll(/URLSearchParams\(/g)]
          .filter((match) => /[{,]\s*["']?q["']?\s*(:|(?=[,}]))/.test(callText(text, match.index + match[0].length - 1)))
          .map((match) => `${file}:${text.slice(0, match.index).split("\n").length}`)
        return [...inText, ...inObject]
      })
    expect(found).toEqual([])
  })

  it("sets q only to text that the user typed, a condition of the api, an empty condition, or an example of the landing page", () => {
    // Each write of q in the source: a call of update or workspaceSearch with a q member, and a presets file.
    const writes: string[] = []
    for (const file of sources()) {
      const joined = code(file).map(({ text }) => text).join("\n")
      for (const match of joined.matchAll(/\b(update|workspaceSearch|writeState)\(/g)) {
        const call = callText(joined, match.index + match[0].length - 1)
        const member = /[{,]\s*q\s*(:\s*([^,}]+)|(?=[,}]))/.exec(call)
        if (member) writes.push(`${file}: ${match[1]}({ q: ${(member[2] ?? "q").trim()} })`)
      }
    }
    expect(writes.sort()).toEqual(
      [
        // The condition of the api in the response of select or keyword.
        "features/workspace/use-condition.ts: update({ q: result.dsl })",
        // The condition of the api that the table was drawn for, restored by a second press of the same element.
        "features/workspace/use-condition.ts: update({ q: populationQ })",
        // The empty condition.
        "features/workspace/use-condition.ts: update({ q: null })",
        // The text that the user typed, which is empty for the empty condition.
        "features/workspace/use-condition.ts: update({ q: text || null })",
        // The condition of the api in the response of parse.
        "lib/condition-href.ts: workspaceSearch({ q: condition.data.dsl })",
      ].sort(),
    )
  })

  it("takes the q of an example of the landing page only in the link of the landing page", () => {
    // The Heatmap preset menu reads the row, the column, and the unit of a preset, and never its q.
    const users = sources().filter((file) => code(file).some(({ text }) => /\bpreset\.state\b(?!\.(row|col|unit)\b)/.test(text)))
    expect(users.sort()).toEqual(["features/landing/landing-page.tsx"])
  })
})
