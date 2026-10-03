import { fc, test } from "@fast-check/vitest"
import { describe, expect, it } from "vitest"

import { escapeXml } from "~/lib/export"

describe("escapeXml", () => {
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
