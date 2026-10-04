/** The number of pages of `total` items at `perPage` items per page; an empty list has one page. */
export const pageCount = (total: number, perPage: number): number => Math.max(1, Math.ceil(total / perPage))

/** The 1-based positions of the first and the last item of a page, or null when the page holds no item. */
export const pageRange = (page: number, perPage: number, total: number): { from: number; to: number } | null => {
  const from = (page - 1) * perPage + 1
  if (total <= 0 || from > total) return null
  return { from, to: Math.min(page * perPage, total) }
}

/** The last page of the list if the page is after it, or null if the page is within the list. An empty list has one page. */
export const pageAfterLast = (page: number, total: number, perPage: number): number | null => {
  const last = pageCount(total, perPage)
  return page > last ? last : null
}
