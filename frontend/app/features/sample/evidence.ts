export type Span = { start: number; end: number }

/**
 * Merge overlapping or touching spans into disjoint ranges, sorted by start.
 * Spans that only touch (one's end equals another's start) merge too, since
 * two adjacent extracted matches read as one continuous highlight.
 */
export const mergeSpans = (spans: Span[]): Span[] => {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ start: span.start, end: span.end })
    }
  }
  return merged
}

export type TextSegment = { text: string; matched: boolean }

/** Splits text into matched/unmatched runs from a set of spans (need not be pre-merged or sorted). */
export const segmentText = (text: string, spans: Span[]): TextSegment[] => {
  const segments: TextSegment[] = []
  let cursor = 0
  for (const span of mergeSpans(spans)) {
    const start = Math.max(cursor, Math.min(span.start, text.length))
    const end = Math.max(start, Math.min(span.end, text.length))
    if (start > cursor) segments.push({ text: text.slice(cursor, start), matched: false })
    if (end > start) segments.push({ text: text.slice(start, end), matched: true })
    cursor = Math.max(cursor, end)
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false })
  return segments.length ? segments : [{ text, matched: false }]
}

export type EvidenceContext = { pre: string; match: string; post: string }

const CONTEXT_MAX = 40

const clipHead = (text: string): string => (text.length > CONTEXT_MAX ? `…${text.slice(text.length - CONTEXT_MAX)}` : text)
const clipTail = (text: string): string => (text.length > CONTEXT_MAX ? `${text.slice(0, CONTEXT_MAX)}…` : text)

/** The matched substring of an evidence span plus up to ~40 characters of surrounding context. */
export const evidenceContext = (source: string, start: number, end: number): EvidenceContext => ({
  pre: clipHead(source.slice(0, start)),
  match: source.slice(start, end),
  post: clipTail(source.slice(end)),
})
