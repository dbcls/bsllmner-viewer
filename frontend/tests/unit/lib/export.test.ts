import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { downloadTsv, escapeXml } from "~/lib/export"

describe("downloadTsv", () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  let blob: Blob | undefined
  let names: string[] = []

  beforeEach(() => {
    blob = undefined
    names = []
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      blob = b as Blob
      return "blob:x"
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
  })

  afterEach(() => {
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
    vi.restoreAllMocks()
  })

  // The Blob of jsdom has no text(), so a FileReader reads it.
  const read = () =>
    new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob as Blob)
    })

  it("writes the header and each value, with an empty cell for null and undefined and a space for each tab and line break, as a TSV file", async () => {
    downloadTsv("table.tsv", ["a", "b", "c", "d", "e"], [["x\ty", null, undefined, 1.5, "p\r\nq"]])
    expect(await read()).toBe("a\tb\tc\td\te\nx y\t\t\t1.5\tp  q\n")
    expect((blob as Blob).type).toBe("text/tab-separated-values")
    expect(names).toEqual(["table.tsv"])
  })

  it("keeps one line when a value holds a carriage return before a line feed", async () => {
    downloadTsv("x.tsv", ["h"], [["a\r\nb", "c\rd"]])
    const text = await read()
    expect(text).not.toMatch(/\r/)
    expect(text.split("\n")).toHaveLength(3)
  })
})

describe("escapeXml", () => {
  it.each([["a\uD800b"], ["\uDC00"], ["￾"], ["x￿y"], ["\uD800"]])("drops the character that XML forbids from %j", (text) => {
    expect(escapeXml(text)).not.toMatch(/[\uD800-\uDFFF￾￿]/)
  })

  it("replaces the characters that XML text and attributes reserve", () => {
    expect(escapeXml("a & b < c > \"d\"")).toBe("a &amp; b &lt; c &gt; &quot;d&quot;")
  })

  it("keeps a character outside the Basic Multilingual Plane and a tab", () => {
    expect(escapeXml("a\u{1F9EC}b\tc")).toBe("a\u{1F9EC}b\tc")
  })
})
