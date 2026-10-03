import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { downloadPngMarkup, smallerPngScale } from "~/lib/export"

const PIXEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0))

describe("smallerPngScale", () => {
  it("halves the scale down to 1 and then gives nothing", () => {
    expect(smallerPngScale(4)).toBe(2)
    expect(smallerPngScale(2)).toBe(1)
    expect(smallerPngScale(1.5)).toBe(1)
    expect(smallerPngScale(1)).toBeNull()
    expect(smallerPngScale(0.4)).toBeNull()
  })
})

describe("downloadPngMarkup", () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  let saved: Blob | undefined
  let sizes: number[]

  /** A canvas that makes no image when it holds more than `limit` pixels, as a browser with a smaller canvas limit does. */
  const stubBrowser = (limit: number) => {
    sizes = []
    saved = undefined
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      saved = b as Blob
      return "blob:x"
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
    vi.stubGlobal("Image", class {
      src = ""
      decode = async () => undefined
    })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn(), set fillStyle(_: string) { /* the color is not read */ } } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
      sizes.push(this.width)
      callback(this.width * this.height > limit ? null : new Blob([PIXEL], { type: "image/png" }))
    })
  }

  // jsdom has no Blob.arrayBuffer, which every browser has.
  beforeEach(() => {
    Blob.prototype.arrayBuffer ??= function (this: Blob) {
      return new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.readAsArrayBuffer(this)
      })
    }
  })
  afterEach(() => {
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>a</text></svg>'

  it("saves at the scale of 4 when the browser makes the image, with 384 dpi in the file", async () => {
    stubBrowser(Infinity)
    await downloadPngMarkup("x.png", svg, 100, 50)
    expect(sizes).toEqual([400])
    const bytes = new Uint8Array(await (saved as Blob).arrayBuffer())
    expect(Array.from(bytes.subarray(33, 37))).toEqual([0, 0, 0, 9])
    expect(new DataView(bytes.buffer).getUint32(41)).toBe(Math.round(384 / 0.0254))
  })

  it("makes the image again at a smaller scale when the browser makes none, and records the dpi of that scale", async () => {
    stubBrowser(250 * 250)
    await downloadPngMarkup("x.png", svg, 100, 100)
    expect(sizes).toEqual([400, 200])
    const bytes = new Uint8Array(await (saved as Blob).arrayBuffer())
    expect(new DataView(bytes.buffer).getUint32(41)).toBe(Math.round(192 / 0.0254))
  })

  it("fails when the browser makes no image even at the scale of 1", async () => {
    stubBrowser(10)
    await expect(downloadPngMarkup("x.png", svg, 100, 100)).rejects.toThrow("could not make the PNG")
    expect(sizes).toEqual([400, 200, 100])
    expect(saved).toBeUndefined()
  })
})
