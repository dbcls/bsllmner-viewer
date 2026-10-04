import { describe, expect, it } from "vitest"

import { PNG_SCALE, pngScale } from "~/lib/export"
import { embedFonts, usedFaces } from "~/lib/figure-fonts"

describe("pngScale", () => {
  it("is 4 for the figures of the page", () => {
    expect(pngScale(960, 400)).toBe(PNG_SCALE)
    expect(pngScale(480, 700)).toBe(PNG_SCALE)
  })
})

const markup = '<svg xmlns="http://www.w3.org/2000/svg" font-family="Public Sans, sans-serif"><text font-weight="600">a</text></svg>'

describe("usedFaces", () => {
  const names = (svg: string) => usedFaces(svg).map((f) => `${f.family} ${f.weight}`)

  it("chooses the faces by what the markup draws with", () => {
    expect(names('<svg font-family="Public Sans, sans-serif"><text>a</text></svg>')).toEqual(["Public Sans 400"])
    expect(names(markup)).toEqual(["Public Sans 600"])
    expect(names(`${markup.slice(0, -6)}<text font-family="IBM Plex Mono, monospace">1</text></svg>`)).toEqual(["Public Sans 600", "IBM Plex Mono 400"])
    expect(names('<svg><text font-weight="500">a</text><text font-family="IBM Plex Mono, monospace" font-weight="600">1</text></svg>')).toEqual(["Public Sans 500", "IBM Plex Mono 600"])
  })

  it("takes the family and the weight of a tspan from the text around it where the tspan sets none", () => {
    expect(names('<svg><text font-weight="500">a<tspan>b</tspan></text></svg>')).toEqual(["Public Sans 500"])
    expect(names('<svg><text font-weight="500">a<tspan font-family="IBM Plex Mono, monospace">b</tspan></text></svg>')).toEqual(["Public Sans 500", "IBM Plex Mono 500"])
    expect(names('<svg><text font-weight="500">a<tspan font-family="IBM Plex Mono, monospace" font-weight="400">b</tspan></text></svg>')).toEqual(["Public Sans 500", "IBM Plex Mono 400"])
  })

  it("does not pass the style of a self-closing tspan to the texts after it", () => {
    expect(names('<svg><text font-weight="500">a<tspan font-family="IBM Plex Mono, monospace"/>b</text><text>c</text></svg>')).toEqual(["Public Sans 400", "Public Sans 500", "IBM Plex Mono 500"])
  })
})

describe("embedFonts", () => {
  it("puts a style with a base64 font-face for each face right after the opening tag, and keeps the rest", async () => {
    const out = await embedFonts(markup.replace("<text", '<text font-weight="500">a</text><text'), async () => "AAAA")
    const doc = new DOMParser().parseFromString(out, "image/svg+xml")
    expect(doc.querySelector("parsererror")).toBeNull()
    expect(doc.documentElement.firstElementChild?.nodeName).toBe("style")
    expect(out.match(/@font-face/g)).toHaveLength(2)
    expect(out).toContain("src:url(data:font/woff2;base64,AAAA)")
    expect(out.endsWith('<text font-weight="600">a</text></svg>')).toBe(true)
  })

  it("returns markup without an opening svg tag as it is", async () => {
    expect(await embedFonts("<g><text>a</text></g>", async () => "AAAA")).toBe("<g><text>a</text></g>")
  })

  it("fails when a font cannot be loaded, so that the caller knows the file has no font", async () => {
    await expect(embedFonts(markup, async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline")
  })
})
