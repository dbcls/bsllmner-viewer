import { useEffect } from "react"

import { pageAfterLast } from "~/ui/page-range"

import type { Update, WorkspaceState } from "./state"

/**
 * Moves to the last page when the page of the URL is past it, as in a URL that was shared before the condition or the
 * number of rows per page changed. It waits for the count of the page's own request, not of the previous one.
 */
export const usePastEnd = (
  list: { data: { pagination: { total: number } } | undefined; isPlaceholderData: boolean },
  page: number,
  perPage: number,
  q: string | null,
  onPastEnd: (page: number, from: { q: string | null; page: number }) => void,
): void => {
  const total = list.data?.pagination.total
  const settled = !list.isPlaceholderData
  useEffect(() => {
    if (total === undefined || !settled) return
    const last = pageAfterLast(page, total, perPage)
    if (last !== null) onPastEnd(last, { q, page })
    // The move is made once for each page and count; the callback only writes the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, settled, page, perPage, q])
}

/**
 * The write of the last page for a count that was for `from`: it replaces the page in the URL only while the URL still has
 * that condition and that page, so that a change made since is not overwritten.
 */
export const replaceIfCurrent = (latest: () => WorkspaceState, update: Update) => (page: number, from: { q: string | null; page: number }) => {
  const now = latest()
  if (now.q === from.q && now.page === from.page) update({ page }, { replace: true })
}
