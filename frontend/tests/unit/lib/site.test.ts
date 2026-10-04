import { describe, expect, it } from "vitest"

import { crawlRel, pageTitle } from "~/lib/site"

describe("pageTitle", () => {
  it("names the site alone on the top page", () => {
    expect(pageTitle()).toBe("bsllmner-viewer")
  })

  it("puts the names from the page up to its section before the name of the site, separated by bars", () => {
    expect(pageTitle("SAMD00000593", "Entries")).toBe("SAMD00000593 | Entries | bsllmner-viewer")
  })
})

describe("crawlRel", () => {
  it.each(["/entries?q=organism_id%3A9606", "/entries?tab=heatmap"])("asks crawlers not to follow a link to the workspace with parameters (%s)", (to) => {
    expect(crawlRel(to)).toBe("nofollow")
  })

  it.each(["/", "/entries", "/entries/SAMD00000593", "/entries/SAMD00000593?x=1", "/api"])("lets crawlers follow a link to an address that robots.txt does not keep them away from (%s)", (to) => {
    expect(crawlRel(to)).toBeUndefined()
  })
})
