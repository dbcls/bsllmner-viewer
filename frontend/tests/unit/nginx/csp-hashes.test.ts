import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../nginx/csp-hashes.mjs")

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Runs the script on a page and returns the path of the include that it writes. */
const run = (html: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "csp-hashes-"))
  made.push(dir)
  const htmlPath = path.join(dir, "index.html")
  const outPath = path.join(dir, "csp-hashes.conf")
  writeFileSync(htmlPath, html)
  execFileSync(process.execPath, [SCRIPT, htmlPath, outPath], { stdio: "pipe" })
  return outPath
}

/** The hashes of an include, after a check of the shape of the include. */
const hashesOf = (out: string): string[] => {
  const text = readFileSync(out, "utf8")
  expect(text).toMatch(/^map "" \$csp_script_hashes \{\n {4}default "[^"]*";\n\}\n$/)
  return text.match(/'sha256-[A-Za-z0-9+/]+={0,2}'/g) ?? []
}

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`

describe("csp-hashes.mjs", () => {
  it("lists the sha256 of the exact text of each inline script, as a browser computes it", () => {
    const module = '\n  import "/assets/entry.js";\n  window.é = "\u{1F600}"\n'
    const out = run(`<html><script></script><script type="module" async="">${module}</script></html>`)
    expect(hashesOf(out)).toEqual(["'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='", sha256(module)])
  })

  it("does not list a script with a src attribute, and lists a script whose attribute only ends with src", () => {
    const out = run('<script src="/a.js"></script><script type="module" src="/b.js"></script><script data-src="x">one()</script>')
    expect(hashesOf(out)).toEqual([sha256("one()")])
  })

  it("lists the hash of a repeated script text once", () => {
    const out = run("<script>a()</script><script>b()</script><script>a()</script>")
    expect(hashesOf(out)).toEqual([sha256("a()"), sha256("b()")])
  })

  it("fails and writes nothing when the page has no inline script", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "csp-hashes-"))
    made.push(dir)
    const htmlPath = path.join(dir, "index.html")
    const outPath = path.join(dir, "csp-hashes.conf")
    writeFileSync(htmlPath, '<script src="/a.js"></script>')
    expect(() => execFileSync(process.execPath, [SCRIPT, htmlPath, outPath], { stdio: "pipe" })).toThrow()
    expect(existsSync(outPath)).toBe(false)
  })
})
