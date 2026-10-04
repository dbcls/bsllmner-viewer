import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"
import { describe, expect, it } from "vitest"

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../app")
const OPENAPI_TYPES = path.join(APP, "lib/api/openapi-types.ts")

/** The operations that the UI does not call: health monitoring only. */
const NOT_CALLED_BY_UI = new Set(["/api/service-info"])

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return /\.tsx?$/.test(entry.name) && file !== OPENAPI_TYPES ? [file] : []
  })

const openApiPaths = (): string[] => {
  const text = readFileSync(OPENAPI_TYPES, "utf8")
  const block = /export interface paths \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? ""
  return [...block.matchAll(/^ {4}"([^"]+)": \{/gm)].map((match) => match[1] as string)
}

const parse = (file: string): ts.SourceFile => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

/** The paths that a source file passes as the first argument of `api.GET(` or `api.POST(`. Comments are not part of the syntax tree. */
const calledPaths = (file: string): string[] => {
  const found: string[] = []
  walk(parse(file), (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return
    const { expression, name } = node.expression
    if (!ts.isIdentifier(expression) || expression.text !== "api" || !["GET", "POST"].includes(name.text)) return
    const [first] = node.arguments
    if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) found.push(first.text)
  })
  return found
}

/** The OpenAPI path that the template of a URL builder writes, where `${name}` stands for `{name}`. */
const builderPath = (file: string, name: string): string | undefined => {
  let found: string | undefined
  walk(parse(file), (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== name || !node.initializer) return
    walk(node.initializer, (inner) => {
      if (found !== undefined) return
      if (ts.isNoSubstitutionTemplateLiteral(inner) && inner.text.startsWith("/api/")) found = inner.text
      if (ts.isTemplateExpression(inner) && inner.head.text.startsWith("/api/")) {
        found = inner.head.text + inner.templateSpans.map((span) => `{${span.expression.getText()}}` + span.literal.text).join("")
      }
    })
  })
  return found
}

const CLIENT = path.join(APP, "lib/api/client.ts")

/** The operations that the UI uses as links, so that the browser downloads the response: the URL builders of the client make their paths. */
const EXPORT_BUILDERS: Record<string, string> = {
  exportEntriesUrl: "/api/export/entries/{type}",
  exportAccessionsUrl: "/api/export/accessions/{type}",
}
const EXPORT_PATHS = Object.fromEntries(Object.values(EXPORT_BUILDERS).map((apiPath) => [apiPath, true]))

/** The names that the file imports from the client of the API. */
const importedFromClient = (file: string): string[] => {
  const names: string[] = []
  walk(parse(file), (node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "~/lib/api/client") return
    const bindings = node.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.map((element) => (element.propertyName ?? element.name).text))
  })
  return names
}

describe("API operations used by the UI", () => {
  const paths = openApiPaths()
  const files = sourceFiles(APP)
  const called = new Set(files.flatMap(calledPaths))

  it("reads the paths of the OpenAPI document", () => {
    expect(paths.length).toBeGreaterThan(10)
    expect(paths).toContain("/api/service-info")
  })

  it("calls every operation of the OpenAPI document with api.GET or api.POST, except service-info and the exports", () => {
    const missing = paths.filter((apiPath) => !NOT_CALLED_BY_UI.has(apiPath) && !(apiPath in EXPORT_PATHS) && !called.has(apiPath))
    expect(missing).toEqual([])
  })

  it("makes the URL of each export operation in the client of the API", () => {
    for (const [name, apiPath] of Object.entries(EXPORT_BUILDERS)) {
      expect(paths, name).toContain(apiPath)
      expect(builderPath(CLIENT, name), name).toBe(apiPath)
    }
  })

  it("uses each URL builder of the exports in the features", () => {
    const imported = new Set(files.filter((file) => file.startsWith(path.join(APP, "features"))).flatMap(importedFromClient))
    for (const name of Object.keys(EXPORT_BUILDERS)) expect(imported.has(name), name).toBe(true)
  })

  it("lists only paths that the OpenAPI document has as not called", () => {
    for (const apiPath of NOT_CALLED_BY_UI) expect(paths).toContain(apiPath)
  })
})
