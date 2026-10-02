/** The workspace URL that a BioSample page returns to: the search string of the list it was opened from. */
export const backHref = (from: string | null): string => (from ? `/entries${from}` : "/entries")

/** The workspace URL whose condition is one annotation term of a field. */
export const termHref = (field: string, termId: string): string => {
  const params = new URLSearchParams()
  params.set("q", `${field}:"${termId}"`)
  return `/entries?${params.toString()}`
}

/** The workspace URL whose condition is one BioProject. */
export const bioprojectHref = (accession: string): string => `/entries?q=bioproject:${accession}`
