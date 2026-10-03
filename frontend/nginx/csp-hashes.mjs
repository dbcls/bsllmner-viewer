// Writes the nginx include that lists the sha256 hash of every inline script of index.html for the script-src of the Content-Security-Policy.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

const [htmlPath, outPath] = process.argv.slice(2)
const html = readFileSync(htmlPath, "utf8")
const hashes = []
for (const match of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  if (/\ssrc=/.test(match[1] ?? "")) continue
  hashes.push(`'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`)
}
if (hashes.length === 0) throw new Error(`no inline script in ${htmlPath}`)
writeFileSync(outPath, `map "" $csp_script_hashes {\n    default "${[...new Set(hashes)].join(" ")}";\n}\n`)
