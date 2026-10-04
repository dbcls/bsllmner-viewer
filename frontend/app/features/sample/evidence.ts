export type Span = { start: number; end: number }

/**
 * A run of text. `matched` is true where a span covers it, and `active` where a span of the active set covers it, such
 * as the evidence of the annotation under the pointer. An active run is also matched.
 */
export type TextSegment = { text: string; matched: boolean; active: boolean }

/**
 * The api reports offsets in code points. Returns the UTF-16 index of the start of each code point in the text, and then
 * the length of the text. A slice at these indexes never splits a surrogate pair.
 */
const codePointStarts = (text: string): number[] => {
  const starts: number[] = []
  for (let at = 0; at < text.length; at += (text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1) starts.push(at)
  starts.push(text.length)
  return starts
}

const covers = (spans: Span[], at: number): boolean => spans.some((span) => span.start <= at && at < span.end)

/**
 * Splits text into the longest runs that have the same matched flag and the same active flag. The spans are in code
 * points and need not be sorted. The spans can overlap or touch, and spans of different sets can overlap. A run that an
 * active span overlaps is active. Spans that touch form one run, because two adjacent extracted matches look like one
 * continuous highlight.
 */
export const segmentText = (text: string, codePointSpans: Span[], codePointActive: Span[] = []): TextSegment[] => {
  const starts = codePointStarts(text)
  const unit = (at: number): number => starts[Math.max(0, Math.min(at, starts.length - 1))] ?? text.length
  const convert = (spans: Span[]): Span[] => spans.map((span) => ({ start: unit(span.start), end: unit(span.end) }))
  const spans = convert(codePointSpans)
  const active = convert(codePointActive)
  const cuts = new Set([0, text.length, ...[...spans, ...active].flatMap((span) => [span.start, span.end])])
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
