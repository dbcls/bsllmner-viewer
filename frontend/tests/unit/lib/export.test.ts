import { fc, test } from "@fast-check/vitest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { downloadTsv, escapeXml } from "~/lib/export"

/** Any UTF-16 code unit, with the ones that the formats treat specially picked often: line breaks, tabs, lone surrogates, and the two non-characters. */
const codeUnit = fc.oneof(
  fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code)),
  fc.constantFrom("\r", "\n", "\t", "&", "<", "\uD800", "\uDBFF", "\uDC00", "\uDFFF", "\uFFFE", "\uFFFF"),
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

  it("keeps one line when a value holds a carriage return before a line feed", async () => {
    const text = await written(["a\r\nb", "c\rd"])
    expect(text).not.toMatch(/\r/)
    expect(text.split("\n")).toHaveLength(3)
  })
})

describe("escapeXml", () => {
  test.prop([anyText])("gives well-formed XML for any text, lone surrogates and non-characters included", (text) => {
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg"><text>${escapeXml(text)}</text></svg>`, "image/svg+xml")
    expect(doc.querySelector("parsererror")).toBeNull()
  })

  it.each([["a\uD800b"], ["\uDC00"], ["\uFFFE"], ["x\uFFFFy"], ["\uD800"]])("drops the character that XML forbids from %j", (text) => {
    expect(escapeXml(text)).not.toMatch(/[\uD800-\uDFFF\uFFFE\uFFFF]/)
  })

  it("replaces the characters that XML text and attributes reserve", () => {
    expect(escapeXml("a & b < c > \"d\"")).toBe("a &amp; b &lt; c &gt; &quot;d&quot;")
  })

  test.prop([fc.string()])("gives text that reads back as the same text inside an SVG element", (text) => {
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg"><text>${escapeXml(text)}</text></svg>`, "image/svg+xml")
    expect(doc.querySelector("parsererror")).toBeNull()
    // XML turns a carriage return into a line feed and drops characters that it does not allow, so compare the text without them.
    const plain = text.replace(/[^ -퟿-�]/gu, "")
    expect(doc.querySelector("text")?.textContent?.replace(/[^ -퟿-�]/gu, "")).toBe(plain)
  })
})
