/**
 * Chart colors computed from the design tokens at runtime, so that components
 * never carry color values of their own.
 */

const FALLBACKS: Record<string, string> = {
  "--color-brand": "#6F4392",
  "--color-brand-light": "#A987C5",
  "--color-brand-soft": "#F4F2FA",
  "--color-brand-deeper": "#3A1F52",
  "--color-brand-tint": "#E7DDF4",
  "--color-under": "#004098",
  "--color-under-soft": "#DFEBFB",
  "--color-surface": "#FFFFFF",
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

/** Four-step brand scale used for counts: soft → light → brand → deeper. */
export const countScale = (t: number): string => {
  if (t <= 0) return token("--color-surface")
  if (t < 0.5) return mix(token("--color-brand-soft"), token("--color-brand-light"), t * 2)
  return mix(token("--color-brand-light"), token("--color-brand-deeper"), (t - 0.5) * 2)
}

/** Whether text on a count-scale background should be white. */
export const countScaleIsDark = (t: number): boolean => t > 0.55

/**
 * Diverging scale for adjusted standardized residuals: under-represented in blue,
 * over-represented in purple, with steps at ±2 and ±4.
 */
export const residualScale = (residual: number | null): string => {
  if (residual === null || Math.abs(residual) < 2) return token("--color-surface")
  const strong = Math.abs(residual) >= 4
  if (residual < 0) return strong ? token("--color-under") : token("--color-under-soft")
  return strong ? token("--color-brand") : token("--color-brand-tint")
}

export const residualScaleIsDark = (residual: number | null): boolean =>
  residual !== null && Math.abs(residual) >= 4
