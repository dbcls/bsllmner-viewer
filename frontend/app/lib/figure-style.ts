/** What the saved figures (Distribution, Heatmap, Trend) share: font sizes, fonts, the heading line, and file names. */

import type { Unit } from "./api/types"
import { token } from "./color"
import { escapeXml } from "./export"

export const FIGURE_SANS = "Public Sans, sans-serif"
export const FIGURE_MONO = "IBM Plex Mono, monospace"

/** The sizes of the text tokens of the page (`--text-fs-*` in tailwind.css), in px. */
export const TEXT_SIZE = { body: 14, "body-sm": 13, label: 12, micro: 11 } as const

type TextWeight = 400 | 500 | 600

/**
 * Where the page sets the text that a role stands for: the file, the Tailwind classes on one element, and
 * the classes on an ancestor that the element inherits from.
 */
type ScreenText = { file: string; classes: string[]; ancestors?: string[] }

type TextRole = { size: keyof typeof TEXT_SIZE; weight: TextWeight; mono: boolean; screen: ScreenText | null }

const DISTRIBUTION = "features/workspace/distribution/distribution-tab.tsx"
const HEATMAP = "features/workspace/heatmap/heatmap-tab.tsx"
const TREND = "features/workspace/trend/trend-tab.tsx"

/** The text of the saved figures by role: the same size, weight, and family as the page sets for the same text. */
export const FIGURE_TEXT = {
  /** The name of the figure. */
  heading: { size: "body", weight: 600, mono: false, screen: { file: DISTRIBUTION, classes: ["inline", "font-semibold"] } },
  /** What the figure counts, at the right of the heading line, and the text of a legend. */
  meta: { size: "label", weight: 400, mono: false, screen: { file: HEATMAP, classes: ["gap-x-6", "text-fs-label", "text-ink-soft"] } },
  /** The ID of a term. */
  termId: { size: "micro", weight: 400, mono: true, screen: { file: "features/workspace/term-id-hover.tsx", classes: ["font-mono", "text-fs-micro", "font-normal"] } },
  barLabel: { size: "body-sm", weight: 400, mono: false, screen: { file: DISTRIBUTION, classes: ["block", "truncate", "text-fs-body-sm"] } },
  barCount: { size: "label", weight: 400, mono: true, screen: { file: DISTRIBUTION, classes: ["w-17", "text-right", "font-mono", "text-fs-label"] } },
  withoutTermLabel: { size: "body-sm", weight: 400, mono: false, screen: { file: DISTRIBUTION, classes: ["border-t", "text-fs-body-sm", "text-ink-soft"] } },
  withoutTermCount: { size: "label", weight: 400, mono: true, screen: { file: DISTRIBUTION, classes: ["shrink-0", "font-mono", "text-fs-label"] } },
  heatColumnLabel: { size: "micro", weight: 500, mono: false, screen: { file: HEATMAP, classes: ["text-fs-micro", "font-medium", "text-balance"] } },
  heatRowLabel: { size: "label", weight: 500, mono: false, screen: { file: HEATMAP, classes: ["text-fs-label", "font-medium", "whitespace-nowrap"] } },
  heatCell: { size: "label", weight: 400, mono: true, screen: { file: HEATMAP, classes: ["h-8", "font-mono", "text-fs-label"] } },
  heatGapCell: { size: "label", weight: 600, mono: true, screen: { file: HEATMAP, classes: ["border-dashed", "font-semibold"], ancestors: ["font-mono", "text-fs-label"] } },
  heatTotal: { size: "label", weight: 400, mono: true, screen: { file: HEATMAP, classes: ["text-right", "font-mono", "whitespace-nowrap", "text-ink-soft"], ancestors: ["text-fs-label"] } },
  heatGrandTotal: { size: "label", weight: 500, mono: true, screen: { file: HEATMAP, classes: ["text-right", "font-mono", "font-medium", "text-ink-mid"], ancestors: ["text-fs-label"] } },
  /** The names of the axes in the corner, and the headings of the totals. */
  heatHeading: { size: "micro", weight: 600, mono: false, screen: { file: HEATMAP, classes: ["text-fs-micro", "font-semibold", "text-ink-soft"] } },
  trendLegendLabel: { size: "label", weight: 400, mono: false, screen: { file: TREND, classes: ["inline-flex", "items-center", "gap-1.5", "text-fs-label"] } },
  trendLegendCondition: { size: "label", weight: 600, mono: false, screen: { file: TREND, classes: ["font-semibold"], ancestors: ["text-fs-label"] } },
  /** The ticks of the axes and the data labels. */
  trendTick: { size: "micro", weight: 400, mono: true, screen: { file: TREND, classes: ["text-fs-micro"], ancestors: ["font-mono"] } },
} as const satisfies Record<string, TextRole>

export type FigureTextRole = keyof typeof FIGURE_TEXT

export const textSize = (role: FigureTextRole): number => TEXT_SIZE[FIGURE_TEXT[role].size]

/**
 * The attributes that set a role on an SVG text. A `tspan` states the family and the weight itself, because it would
 * take them from the text around it.
 */
export const textAttrs = (role: FigureTextRole, tspan = false): string => {
  const { weight, mono } = FIGURE_TEXT[role]
  return [
    mono || tspan ? `font-family="${mono ? FIGURE_MONO : FIGURE_SANS}"` : "",
    `font-size="${textSize(role)}"`,
    weight !== 400 || tspan ? `font-weight="${weight}"` : "",
  ].filter(Boolean).join(" ")
}

/** The advance of a character as a fraction of the font size: IBM Plex Mono, and a cautious mean for Public Sans. */
const MONO_ADVANCE = 0.6
const SANS_ADVANCE = 0.58

/** The width of `text` in px, estimated from the font size, for laying out text before it is drawn. */
export const textWidth = (text: string, size: number, mono = false): number => Array.from(text).length * size * (mono ? MONO_ADVANCE : SANS_ADVANCE)

/**
 * A label of at most `length` characters, counted in code points so that a surrogate pair is not split. A longer label
 * ends with an ellipsis, so that a cut label is not read as another term.
 */
export const cut = (label: string, length: number): string => {
  const characters = Array.from(label)
  return characters.length <= length ? label : `${characters.slice(0, Math.max(1, length - 1)).join("")}…`
}

/** The space at the left and right edges of a saved figure, in px. */
export const FIGURE_MARGIN = 12

/** The height of the heading line that `headingSvg` writes. */
export const HEADING_HEIGHT = 32

/** The name of the figure at the left and what it counts at the right, on one line at the top of the figure. */
export const headingSvg = (width: number, title: string, meta: string): string =>
  `<text x="${FIGURE_MARGIN}" y="20" ${textAttrs("heading")} fill="${token("--color-ink")}">${escapeXml(cut(title, Math.max(8, Math.floor((width - 2 * FIGURE_MARGIN - textWidth(meta, textSize("meta"))) / (textSize("heading") * SANS_ADVANCE)) - 2)))}</text>` +
  `<text x="${width - FIGURE_MARGIN}" y="20" text-anchor="end" ${textAttrs("meta")} fill="${token("--color-ink-soft")}">${escapeXml(meta)}</text>`

/** The name of a saved figure: the figure, then the fields that it shows, then the unit, and a variant when there is one. */
export const figureFileName = (figure: "distribution" | "heatmap" | "trend", fields: string[], unit: Unit, extension: "tsv" | "svg" | "png", variant?: string): string =>
  `${[figure, fields.join("-x-"), unit, variant].filter((part) => part !== undefined && part !== "").join("-")}.${extension}`
