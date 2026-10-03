/** The fonts of the saved figures, embedded in the SVG so that the file looks the same where the fonts are not installed. */

import plexMono400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url"
import plexMono500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url"
import plexMono600 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url"
import publicSans400 from "@fontsource/public-sans/files/public-sans-latin-400-normal.woff2?url"
import publicSans500 from "@fontsource/public-sans/files/public-sans-latin-500-normal.woff2?url"
import publicSans600 from "@fontsource/public-sans/files/public-sans-latin-600-normal.woff2?url"

type Face = { family: string; weight: number; url: string }

const FACES: Face[] = [
  { family: "Public Sans", weight: 400, url: publicSans400 },
  { family: "Public Sans", weight: 500, url: publicSans500 },
  { family: "Public Sans", weight: 600, url: publicSans600 },
  { family: "IBM Plex Mono", weight: 400, url: plexMono400 },
  { family: "IBM Plex Mono", weight: 500, url: plexMono500 },
  { family: "IBM Plex Mono", weight: 600, url: plexMono600 },
]

/** The family and the weight of a text that no attribute of it or of a text around it sets. */
const ROOT_STYLE = { mono: false, weight: 400 }

/**
 * The faces that the markup draws with: for each `text` and `tspan`, the family (the mono when it names IBM Plex Mono,
 * the sans otherwise) and the weight (400 when no `font-weight` is set), where a `tspan` takes what it does not set
 * from the `text` around it.
 */
export const usedFaces = (markup: string): Face[] => {
  const used = new Set<string>()
  const stack: { mono: boolean; weight: number }[] = []
  for (const tag of markup.matchAll(/<(\/?)(text|tspan)\b([^>]*?)(\/?)>/g)) {
    const [, closing, , attributes = "", selfClosing] = tag
    if (closing) {
      stack.pop()
      continue
    }
    const parent = stack[stack.length - 1] ?? ROOT_STYLE
    const family = /\bfont-family="([^"]*)"/.exec(attributes)?.[1]
    const weight = /\bfont-weight="(\d+)"/.exec(attributes)?.[1]
    const style = { mono: family === undefined ? parent.mono : family.includes("IBM Plex Mono"), weight: weight === undefined ? parent.weight : Number(weight) }
    used.add(`${style.mono}:${style.weight}`)
    if (!selfClosing) stack.push(style)
  }
  return FACES.filter((face) => used.has(`${face.family === "IBM Plex Mono"}:${face.weight}`))
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

export type FontLoader = (url: string) => Promise<string>

/** The font file at `url` as base64. */
export const fetchFontBase64: FontLoader = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`could not load the font ${url}`)
  return toBase64(new Uint8Array(await response.arrayBuffer()))
}

const fontStyle = (faces: { family: string; weight: number; data: string }[]): string =>
  `<style>${faces
    .map((face) => `@font-face{font-family:"${face.family}";font-weight:${face.weight};font-style:normal;src:url(data:font/woff2;base64,${face.data}) format("woff2")}`)
    .join("")}</style>`

/**
 * The SVG markup with the fonts it draws with embedded as base64 `@font-face` rules, after the opening tag. A font that
 * cannot be loaded rejects, so that the caller does not save a figure without its fonts. Markup without an opening svg
 * tag is returned as it is.
 */
export const embedFonts = async (markup: string, load: FontLoader = fetchFontBase64): Promise<string> => {
  const faces = usedFaces(markup)
  const loaded = await Promise.all(faces.map(async (face) => ({ ...face, data: await load(face.url) })))
  const open = /^<svg\b[^>]*>/.exec(markup)
  if (!open) return markup
  return `${open[0]}${fontStyle(loaded)}${markup.slice(open[0].length)}`
}
