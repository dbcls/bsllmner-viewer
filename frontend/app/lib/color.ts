/**
 * Chart colors computed from the design tokens at runtime, so that components
 * do not define color values of their own.
 */

const FALLBACKS: Record<string, string> = {
  "--color-brand": "#6F4392",
  "--color-brand-light": "#A987C5",
  "--color-brand-soft": "#F4F2FA",
  "--color-brand-deeper": "#3A1F52",
  "--color-brand-tint": "#E7DDF4",
  "--color-surface": "#FFFFFF",
  "--color-ink": "#1A1726",
  "--color-ink-soft": "#6E6A7B",
  "--color-skeleton": "#ECE9F2",
}

const cache = new Map<string, string>()

export const token = (name: string): string => {
  const cached = cache.get(name)
  if (cached) return cached
  let value = ""
  if (typeof document !== "undefined") {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }
  const resolved = value || FALLBACKS[name] || "#000000"
  cache.set(name, resolved)
  return resolved
}

type Rgb = [number, number, number]

const toRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
}

export const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = toRgb(a)
  const [br, bg, bb] = toRgb(b)
  const k = Math.min(1, Math.max(0, t))
  const c = (x: number, y: number) => Math.round(x + (y - x) * k)
  return `rgb(${c(ar, br)}, ${c(ag, bg)}, ${c(ab, bb)})`
}

/** Position of a count on a log scale between 0 and the maximum, in [0, 1]. */
export const logPosition = (value: number, max: number): number => {
  if (value <= 0 || max <= 0) return 0
  return Math.log(1 + value) / Math.log(1 + max)
}

type ScaleStop = { token: string; at: number }

/**
 * The colors of the count scale and the log positions where the scale reaches them. `countScale` gives the color of a
 * cell from these stops. The legend on the page and the legend of the saved figure draw their gradients from the same
 * stops, so that each legend shows the color of a cell at each position.
 */
export const COUNT_SCALE_STOPS: readonly [ScaleStop, ScaleStop, ...ScaleStop[]] = [
  { token: "--color-brand-soft", at: 0 },
  { token: "--color-brand-light", at: 0.5 },
  { token: "--color-brand-deeper", at: 1 },
]

/**
 * The color of a count on the count scale, from its log position t. A t of 0 or less is the surface color. Above 0, the
 * color goes linearly between the two stops of `COUNT_SCALE_STOPS` around t.
 */
export const countScale = (t: number): string => {
  if (t <= 0) return token("--color-surface")
  const next = COUNT_SCALE_STOPS.findIndex((stop) => t < stop.at)
  const index = next === -1 ? COUNT_SCALE_STOPS.length - 1 : next
  const from = COUNT_SCALE_STOPS[index - 1] ?? COUNT_SCALE_STOPS[0]
  const to = COUNT_SCALE_STOPS[index] ?? COUNT_SCALE_STOPS[1]
  return mix(token(from.token), token(to.token), (t - from.at) / (to.at - from.at))
}

/** The red, green, and blue of a hex color or of an `rgb(r, g, b)` color, as `mix` writes it. */
const channels = (color: string): Rgb => {
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : toRgb(color)
}

/** The relative luminance of a color, as WCAG defines it. */
const luminance = (color: string): number => {
  const [r, g, b] = channels(color).map((value) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG contrast ratio of two colors, from 1 to 21. */
export const contrastRatio = (a: string, b: string): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

/**
 * Whether text on a count-scale background should be white: the text takes whichever of white and the ink has the higher
 * contrast with the cell. In the middle of the scale neither reaches 4.5:1; the better of the two is 4.2:1 or more.
 */
export const countScaleIsDark = (t: number): boolean => {
  const background = countScale(t)
  return contrastRatio(background, token("--color-surface")) > contrastRatio(background, token("--color-ink"))
}

/** The ratios to the expected count at which the color of `ratioScale` changes. */
export const RATIO_STEPS = { low: 0.5, mid: 2, high: 4 }

/**
 * Scale for the ratio of a count to its expected count, in the brand purple: the higher the ratio, the darker the cell,
 * as on the count scale. Half or less of the expected count is not colored, so that the cells below it read as holes in
 * the table. The steps are at half, twice, and four times; a cell without a ratio is not colored.
 */
export const ratioScale = (ratio: number | null): string => {
  if (ratio === null || ratio <= RATIO_STEPS.low) return token("--color-surface")
  if (ratio < RATIO_STEPS.mid) return token("--color-brand-tint")
  return ratio >= RATIO_STEPS.high ? token("--color-brand") : token("--color-brand-light")
}

export const ratioScaleIsDark = (ratio: number | null): boolean => ratio !== null && ratio >= RATIO_STEPS.high
