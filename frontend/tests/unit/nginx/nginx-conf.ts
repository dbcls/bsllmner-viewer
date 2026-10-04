import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** A directive or a block of an nginx configuration. A line of a `map` block is a node whose name is the key. */
export interface Node {
  name: string
  args: string[]
  children?: Node[]
}

const TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../nginx/default.conf.template",
)

interface Token {
  text: string
  punct: boolean
}

const at = <T>(items: readonly T[], index: number): T => {
  const item = items[index]
  if (item === undefined) throw new Error(`no item at ${index}`)
  return item
}

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const c = source.charAt(i)
    if (/\s/.test(c)) {
      i++
    } else if (c === "#") {
      while (i < source.length && source.charAt(i) !== "\n") i++
    } else if (c === ";" || c === "{" || c === "}") {
      tokens.push({ text: c, punct: true })
      i++
    } else if (c === "'" || c === "\"") {
      let text = ""
      i++
      while (i < source.length && source.charAt(i) !== c) {
        if (source.charAt(i) === "\\" && (source.charAt(i + 1) === c || source.charAt(i + 1) === "\\")) i++
        text += source.charAt(i)
        i++
      }
      if (i >= source.length) throw new Error("unterminated string")
      i++
      tokens.push({ text, punct: false })
    } else {
      let text = ""
      while (i < source.length && !/\s/.test(source.charAt(i)) && source.charAt(i) !== ";") {
        text += source.charAt(i)
        i++
      }
      tokens.push({ text, punct: false })
    }
  }
  return tokens
}

const parseBlock = (tokens: Token[], start: number, closing: boolean): [Node[], number] => {
  const nodes: Node[] = []
  let i = start
  let words: string[] = []
  while (i < tokens.length) {
    const token = at(tokens, i)
    if (token.punct && token.text === ";") {
      nodes.push({ name: at(words, 0), args: words.slice(1) })
      words = []
      i++
    } else if (token.punct && token.text === "{") {
      const [children, next] = parseBlock(tokens, i + 1, true)
      nodes.push({ name: at(words, 0), args: words.slice(1), children })
      words = []
      i = next
    } else if (token.punct && token.text === "}") {
      if (!closing) throw new Error("unexpected }")
      return [nodes, i + 1]
    } else {
      words.push(token.text)
      i++
    }
  }
  if (closing) throw new Error("missing }")
  return [nodes, i]
}

/** Replaces `${NAME}` with the value of the environment variable, as the nginx image does, and parses the result. */
export const loadTemplate = (env: Record<string, string>): Node[] => {
  const text = readFileSync(TEMPLATE, "utf8").replace(/\$\{(\w+)\}/g, (whole: string, name: string) => env[name] ?? whole)
  return parseBlock(tokenize(text), 0, false)[0]
}

export const server = (nodes: Node[]): Node => {
  const found = nodes.find((node) => node.name === "server")
  if (!found?.children) throw new Error("no server block")
  return found
}

/** The location blocks at any depth, with the `location` arguments joined by a space. */
export const locations = (node: Node): { match: string; node: Node }[] =>
  (node.children ?? []).flatMap((child) =>
    child.name === "location" ? [{ match: child.args.join(" "), node: child }, ...locations(child)] : [],
  )

export const location = (nodes: Node[], match: string): Node => {
  const found = locations(server(nodes)).find((candidate) => candidate.match === match)
  if (!found) throw new Error(`no location ${match}`)
  return found.node
}

/** The directives with this name that a block holds directly. */
export const directives = (node: Node, name: string): string[][] =>
  (node.children ?? []).filter((child) => child.name === name).map((child) => child.args)

type Vars = Record<string, string>

const interpolate = (text: string, nodes: Node[], vars: Vars, captures: string[] = []): string =>
  text.replace(/\$(\w+)/g, (_, name: string) => {
    if (/^\d+$/.test(name)) return captures[Number(name)] ?? ""
    const value = vars[name]
    if (value !== undefined) return value
    if (nodes.some((node) => node.name === "map" && node.args[1] === `$${name}`)) {
      return evaluateMap(nodes, name, vars)
    }
    throw new Error(`unknown variable $${name}`)
  })

/** The text of a `return` or another directive value, with its variables replaced. */
export const expand = (nodes: Node[], text: string, vars: Vars): string => interpolate(text, nodes, vars)

/**
 * The value of a `map` variable. An exact key (compared without regard to case, as nginx does) wins over the regular
 * expressions. Then the first regular expression that matches wins. Then `default`, or the empty string. If the source
 * is empty, no regular expression is tried, as in nginx.
 */
export const evaluateMap = (nodes: Node[], variable: string, vars: Vars): string => {
  const map = nodes.find((node) => node.name === "map" && node.args[1] === `$${variable}`)
  if (!map?.children) throw new Error(`no map for $${variable}`)
  const source = interpolate(at(map.args, 0), nodes, vars)
  const entries = map.children
  const exact = entries.find(
    (entry) => entry.name !== "default" && !entry.name.startsWith("~") && entry.name.toLowerCase() === source.toLowerCase(),
  )
  if (exact) return interpolate(at(exact.args, 0), nodes, vars)
  if (source !== "") {
    for (const entry of entries) {
      if (!entry.name.startsWith("~")) continue
      const insensitive = entry.name.startsWith("~*")
      const match = new RegExp(entry.name.slice(insensitive ? 2 : 1), insensitive ? "i" : "").exec(source)
      if (match) return interpolate(at(entry.args, 0), nodes, vars, [...match])
    }
  }
  const fallback = entries.find((entry) => entry.name === "default")
  return fallback ? interpolate(at(fallback.args, 0), nodes, vars) : ""
}
