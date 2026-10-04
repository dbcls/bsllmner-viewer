/** The name of the site: the title of the top page, and the end of the title of every other page. */
export const SITE_NAME = "bsllmner-viewer"

/** The name of the section of the pages under `/entries`: the workspace and the BioSample pages. */
export const ENTRIES_SECTION = "Entries"

/** What the site lets a reader do, the first sentence of the top page. */
export const SITE_PURPOSE = "Search BioSamples by the ontology terms that annotate them, and compare the results in tables and charts."

/** What the site does, for search results and the previews of shared links. */
export const SITE_DESCRIPTION = `${SITE_PURPOSE} bsllmner-mk2 makes the annotations from the attributes of each BioSample with a large language model.`

/**
 * The title of a page: the names from the page up to its section, and then the name of the site, separated by bars
 * (`SAMD00000593 | Entries | bsllmner-viewer`).
 */
export const pageTitle = (...names: string[]): string => [...names, SITE_NAME].join(" | ")

/**
 * The `rel` of a link to an address of the site: `nofollow` for the workspace with parameters, which robots.txt
 * disallows for crawlers on a deployment that search engines index. The link and robots.txt then give a crawler the
 * same rule, so the address is not listed in search results because of the link alone.
 */
export const crawlRel = (to: string): "nofollow" | undefined => (to.startsWith("/entries?") ? "nofollow" : undefined)
