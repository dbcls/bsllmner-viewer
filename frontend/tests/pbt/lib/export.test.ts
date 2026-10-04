import { fc, test } from "@fast-check/vitest"
import { afterEach, beforeEach, describe, expect, vi } from "vitest"

import { downloadTsv, escapeXml } from "~/lib/export"

/** Any UTF-16 code unit, with the ones that the formats treat specially picked often: line breaks, tabs, lone surrogates, and the two non-characters. */
const codeUnit = fc.oneof(
  fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code)),
  fc.constantFrom("\r", "\n", "\t", "&", "<", "\uD800", "\uDBFF", "\uDC00", "\uDFFF", "￾", "￿"),
)
const anyText = fc.string({ unit: codeUnit })

describe("downloadTsv", () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  let blob: Blob | undefined

  beforeEach(() => {
    blob = undefined
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      blob = b as Blob
      return "blob:x"
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
  })

  afterEach(() => {
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
    vi.restoreAllMocks()
  })

  const written = (values: string[]) => {
    downloadTsv("x.tsv", ["h"], [values])
    return new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob as Blob)
    })
  }

  test.prop([fc.array(anyText, { minLength: 1, maxLength: 4 }), fc.nat(3)])(
    "keeps one line per row whatever line breaks the values hold, with a carriage return in some value",
    async (values, at) => {
      const withReturn = values.map((value, index) => (index === at % values.length ? `${value}\r${value}` : value))
      const text = await written(withReturn)
      expect(text).not.toMatch(/\r/)
      expect(text.split("\n")).toHaveLength(3)
      expect(text.split("\n")[1]?.split("\t")).toHaveLength(values.length)
    },
  )
})

describe("escapeXml", () => {
  /** The characters that XML 1.0 allows, written as code point ranges and not as the pattern of the app. */
  const allowed = (point: number) => point === 0x9 || point === 0xa || point === 0xd || (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) || point >= 0x10000

  test.prop([fc.oneof(anyText, fc.string({ unit: "binary" }), fc.string({ unit: "grapheme" }))])(
    "reads back as the text without the characters that XML 1.0 forbids",
    (text) => {
      const kept = [...text].filter((character) => allowed(character.codePointAt(0) as number)).join("")
      // An XML parser reads a carriage return, with or without a line feed after it, as a line feed.
      const expected = kept.replace(/\r\n?/g, "\n")
      const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg"><text>${escapeXml(text)}</text></svg>`, "image/svg+xml")
      expect(doc.querySelector("text")?.textContent).toBe(expected)
    },
  )
})
