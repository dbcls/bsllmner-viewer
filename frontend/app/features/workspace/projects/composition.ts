import type { Composition } from "~/lib/api/types"

type CompositionSegment = Composition["segments"][number]

const KIND_ORDER: CompositionSegment["kind"][] = ["term", "other", "unmapped", "no_value"]

const KIND_LABEL: Record<Exclude<CompositionSegment["kind"], "term">, string> = {
  other: "other",
  unmapped: "unmapped",
  no_value: "no value",
}

export type CompositionSegmentView = {
  kind: CompositionSegment["kind"]
  pct: number
  title: string
}

/** Stacked-bar segments for a project's composition, in a fixed kind order regardless of api order. */
export const compositionSegments = (composition: Composition): CompositionSegmentView[] => {
  if (composition.total <= 0) return []
  const byKind = new Map(composition.segments.map((segment) => [segment.kind, segment]))
  return KIND_ORDER.flatMap((kind) => {
    const segment = byKind.get(kind)
    if (!segment) return []
    const pct = Math.round((segment.count / composition.total) * 100)
    if (pct <= 0) return []
    const label = kind === "term" ? (segment.label ?? "?") : KIND_LABEL[kind]
    return [{ kind, pct, title: `${label} ${pct}%` }]
  })
}

/** Summary line under the bar: the main term's share, plus the "other" share when it is at least 4%. */
export const compositionSummary = (composition: Composition): string => {
  if (composition.total <= 0) return ""
  const byKind = new Map(composition.segments.map((segment) => [segment.kind, segment]))
  const term = byKind.get("term")
  if (!term) return ""
  const termPct = Math.round((term.count / composition.total) * 100)
  const label = term.label ?? "?"
  const other = byKind.get("other")
  const otherPct = other ? Math.round((other.count / composition.total) * 100) : 0
  return otherPct >= 4 ? `${label} ${termPct}% · other ${otherPct}%` : `${label} ${termPct}%`
}

/** The fields whose composition the project table shows when the condition names no annotation field. */
const FALLBACK_FIELDS = ["disease", "cell_line", "tissue"]
const MAX_FIELDS = 3

/** The annotation fields whose composition the project table shows: up to 3 that the condition names, in their order. */
export const compositionFields = (conditionFields: readonly string[], annotationFields: ReadonlySet<string>): string[] => {
  const named = [...new Set(conditionFields.filter((field) => annotationFields.has(field)))].slice(0, MAX_FIELDS)
  return named.length ? named : FALLBACK_FIELDS
}
