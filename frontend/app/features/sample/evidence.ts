export type Span = { start: number; end: number }

/**
 * A run of text. `matched` is true where a span covers it, and `active` where a span of the active set covers it, such
 * as the evidence of the annotation under the pointer. An active run is also matched.
 */
export type TextSegment = { text: string; matched: boolean; active: boolean }

const covers = (spans: Span[], at: number): boolean => spans.some((span) => span.start <= at && at < span.end)

/**
 * Splits text into the longest runs that are alike in being matched and in being active. The spans need not be sorted
 * and may overlap or touch, and spans of different sets may overlap: where an active span overlaps another span, the run
 * is active. Spans that touch read as one run, since two adjacent extracted matches read as one continuous highlight.
 */
export const segmentText = (text: string, spans: Span[], active: Span[] = []): TextSegment[] => {
  const clamp = (at: number): number => Math.max(0, Math.min(at, text.length))
  const cuts = new Set([0, text.length, ...[...spans, ...active].flatMap((span) => [clamp(span.start), clamp(span.end)])])
  const points = [...cuts].sort((a, b) => a - b)
  const segments: TextSegment[] = []
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1] ?? 0
    const end = points[index] ?? start
    const isActive = covers(active, start)
    const isMatched = isActive || covers(spans, start)
    const last = segments[segments.length - 1]
    if (last && last.matched === isMatched && last.active === isActive) {
      last.text += text.slice(start, end)
    } else {
      segments.push({ text: text.slice(start, end), matched: isMatched, active: isActive })
    }
  }
  return segments.length ? segments : [{ text, matched: false, active: false }]
}
