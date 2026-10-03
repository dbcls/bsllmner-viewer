/** Client-side downloads: TSV tables, SVG markup, and PNG renderings of SVG markup. */

import { token } from "./color"
import { embedFonts } from "./figure-fonts"
import { setPngResolution } from "./png"

/** Characters that XML 1.0 does not allow: most control characters, lone surrogates, and U+FFFE and U+FFFF. */
// eslint-disable-next-line no-control-regex
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** Text for the content or an attribute value of an SVG element. */
export const escapeXml = (text: string): string =>
  text
    .replace(XML_FORBIDDEN, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

const download = (name: string, content: Blob): void => {
  const url = URL.createObjectURL(content)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

const tsvCell = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? "" : String(value).replace(/[\t\r\n]/g, " ")

export const downloadTsv = (name: string, header: string[], rows: (string | number | null | undefined)[][]): void => {
  const lines = [header, ...rows].map((row) => row.map(tsvCell).join("\t"))
  download(name, new Blob([`${lines.join("\n")}\n`], { type: "text/tab-separated-values" }))
}

/** What the screen says when a figure could not be saved, as when its fonts could not be loaded. */
export const FIGURE_SAVE_FAILED = "Could not save the figure."

/** The SVG markup of a figure with its fonts embedded, saved as a file. */
export const downloadSvgMarkup = async (name: string, markup: string): Promise<void> => {
  download(name, new Blob([await embedFonts(markup)], { type: "image/svg+xml" }))
}

/** The scale of a saved PNG: 4 gives about 550 dpi when a 960px figure is printed 7 inches wide. */
export const PNG_SCALE = 4
/** The most that a canvas holds in Chromium and Firefox: the length of a side, and the area, in px. */
const CANVAS_MAX_SIDE = 16384
const CANVAS_MAX_AREA = 268_435_456
/** The resolution of an unscaled figure, in dots per inch. */
const BASE_DPI = 96

/** The scale for a figure of `width` x `height`: `preferred`, or less when the canvas would pass its limits. */
export const pngScale = (width: number, height: number, preferred = PNG_SCALE): number =>
  Math.min(preferred, CANVAS_MAX_SIDE / Math.max(width, height), Math.sqrt(CANVAS_MAX_AREA / (width * height)))

/** The scale to try after `scale` produced no image: half of it, and never less than 1. Nothing when `scale` is already 1 or less. */
export const smallerPngScale = (scale: number): number | null => (scale <= 1 ? null : Math.max(1, scale / 2))

/** The figure drawn on a white canvas at `scale` as a PNG, or null when the browser makes no canvas or no image of that size. */
const renderPng = async (image: HTMLImageElement, width: number, height: number, scale: number): Promise<Blob | null> => {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.floor(width * scale))
  canvas.height = Math.max(1, Math.floor(height * scale))
  const context = canvas.getContext("2d")
  if (!context) return null
  context.fillStyle = token("--color-surface")
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
}

/**
 * The SVG markup of a figure drawn on a white canvas at `pngScale`, saved as a PNG file with a resolution of 96 dpi times
 * the scale. The fonts are embedded in the image. A browser that makes no image of a canvas of that size gets a smaller
 * scale, down to 1; at 1 it is an error.
 */
export const downloadPngMarkup = async (name: string, markup: string, width: number, height: number): Promise<void> => {
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await embedFonts(markup))}`
  try {
    await image.decode()
  } catch {
    throw new Error("could not render the SVG")
  }
  let scale: number | null = pngScale(width, height)
  while (scale !== null) {
    const blob = await renderPng(image, width, height, scale)
    if (blob) {
      download(name, new Blob([setPngResolution(new Uint8Array(await blob.arrayBuffer()), BASE_DPI * scale)], { type: "image/png" }))
      return
    }
    scale = smallerPngScale(scale)
  }
  throw new Error("could not make the PNG")
}

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
