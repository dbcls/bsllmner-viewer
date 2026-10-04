import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { fc, test } from "@fast-check/vitest"
import { describe, expect, it } from "vitest"

import { estimatedRows } from "~/features/workspace/condition-bar"

/** The grammar of conditions in the backend: backend/ of the repository, or /backend in the container. */
const GRAMMAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../backend/src/bsllmner_viewer/dsl/grammar.lark")

/** The pattern of a terminal of the grammar, such as `PHRASE.5: /.../`, as a sticky regular expression. */
const terminal = (grammar: string, name: string): RegExp => {
  const line = grammar.split("\n").find((text) => text.startsWith(`${name}.`)) ?? ""
  return new RegExp(line.slice(line.indexOf("/") + 1, line.lastIndexOf("/")), "y")
}

/**
 * The field names of a condition as the lexer of the grammar reads them: from the left, a token is a phrase if PHRASE
 * matches where the token starts, then a word if WORD matches, and otherwise one character. A field name is a word
 * that `:` follows.
 */
const lexedFields = (grammar: string) => {
  const phrase = terminal(grammar, "PHRASE")
  const word = terminal(grammar, "WORD")
  const at = (pattern: RegExp, text: string, index: number): string | null => {
    pattern.lastIndex = index
    return pattern.exec(text)?.[0] ?? null
  }
  return (q: string): Set<string> => {
    const names = new Set<string>()
    let index = 0
    while (index < q.length) {
      if (/\s/.test(q[index] ?? "")) {
        index += 1
        continue
      }
      const quoted = at(phrase, q, index)
      const token = quoted ?? at(word, q, index) ?? q[index] ?? ""
      if (quoted === null && q[index + token.length] === ":" && /^[A-Za-z_]\w*$/.test(token)) names.add(token)
      index += token.length
    }
    return names
  }
}

/** Characters that include the ones that make a phrase look like a condition: quotes, backslashes, colons, parentheses, and white space. */
const phraseChar = fc.constantFrom("a", "Z", "1", " ", ":", "(", ")", "\\", '"', "'", "\n", "x:", " c:", "(d:")
const phraseText = fc.array(phraseChar, { maxLength: 12 }).map((chars) => chars.join(""))

/**
 * A word of the condition grammar that has single quotes after its first character, as in `Alzheimer's` or `3'UTR`. A
 * single quote inside a word is part of the word and does not start a phrase.
 */
const quotedWord = fc
  .tuple(fc.constantFrom("a", "Z", "3"), fc.array(fc.constantFrom("a", "'", "-", "1", "\\"), { maxLength: 6 }))
  .map(([first, rest]) => `${first}${rest.join("")}'`)

/** A phrase of the condition grammar: the text in double or single quotes, with the quote and the backslash escaped. */
const phrase = fc.tuple(phraseText, fc.constantFrom('"', "'")).map(([text, quote]) => `${quote}${text.replace(/[\\"']/g, (c) => (c === quote || c === "\\" ? `\\${c}` : c))}${quote}`)

describe("estimatedRows", () => {
  it("does not count a field name inside a phrase with an escaped quote", () => {
    expect(estimatedRows('a:"x \\" b:y"')).toBe(1)
    expect(estimatedRows('a:"x \\" b:y" AND c:1')).toBe(2)
  })

  it("does not count a field name inside a phrase in single quotes", () => {
    expect(estimatedRows("a:'x b:y'")).toBe(1)
    expect(estimatedRows("a:'x \\' b:y' AND c:1")).toBe(2)
  })

  it("counts the fields between words that have a single quote inside them", () => {
    expect(estimatedRows("3'UTR AND disease:\"MONDO:0005011\" AND tissue:\"UBERON:0000955\" AND cell_line:'CLO:0000001'")).toBe(3)
    expect(estimatedRows("Crohn's AND a:x AND b:y AND Alzheimer's")).toBe(2)
  })

  test.prop([quotedWord, quotedWord, phrase], { numRuns: 500 })("does not read a single quote inside a word as the start of a phrase", (before, after, value) => {
    expect(estimatedRows(`${before} AND a:x AND b:${value} AND ${after}`)).toBe(2)
  })

  it("closes a single-quoted phrase only at a quote that a space, a parenthesis, or the end follows", () => {
    expect(estimatedRows("'s a:x y's AND b:z")).toBe(2)
    expect(estimatedRows("x 's AND a:b AND c:d")).toBe(2)
    expect(estimatedRows("'Alzheimer's disease' AND a:b")).toBe(1)
    expect(estimatedRows("'Alzheimer's x:y' AND a:b")).toBe(1)
  })

  /** Tokens that put single quotes inside words, at the start of words, and inside phrases, between field clauses. */
  const token = fc.constantFrom("a:x", "b:y", "c:'v w'", "d:\"u:v\"", "'s", "x's", "y'", "'s e:z y's", "'Alzheimer's f:z'", "AND", "OR", "(", ")", "g:'h's'")

  test.prop([fc.array(token, { minLength: 1, maxLength: 10 })], { numRuns: 1000 })("counts the field names that the lexer of the backend grammar reads", (tokens) => {
    const q = tokens.join(" ")
    expect(estimatedRows(q)).toBe(Math.max(1, lexedFields(readFileSync(GRAMMAR, "utf8"))(q).size))
  })

  test.prop([phrase, phrase], { numRuns: 500 })("does not change the number of rows by the content of a phrase", (first, second) => {
    expect(estimatedRows(`a:${first}`)).toBe(1)
    expect(estimatedRows(`a:${first} AND (b:${second} OR b:${first})`)).toBe(2)
    expect(estimatedRows(`${first} AND a:${second} AND (c:1)`)).toBe(2)
  })
})
