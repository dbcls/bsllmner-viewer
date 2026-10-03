/**
 * What the BioSample page keeps of the list that it was opened from: the search string of the workspace URL. The page
 * carries it in the history entry, not in its own URL, so that the URL of a BioSample names the BioSample only.
 */
export type BackLinkState = { from: string }

/** The history state to open a BioSample page with, from the search string of the workspace URL of the list. */
export const backLinkState = (search: string): BackLinkState => ({ from: search })

/**
 * The workspace URL that a BioSample page returns to: the list that it was opened from, or the whole dataset when the
 * page was opened by its URL. A search string that does not start with `?` is ignored, so the link stays on `/entries`.
 */
export const backHref = (state: unknown): string => {
  const from = typeof state === "object" && state !== null && "from" in state ? state.from : null
  return typeof from === "string" && from.startsWith("?") && from.length > 1 ? `/entries${from}` : "/entries"
}
