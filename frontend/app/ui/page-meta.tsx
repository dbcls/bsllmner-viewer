type PageMetaProps = {
  title: string
  /** The summary that search results show under the title. */
  description?: string | undefined
  /** The path of the address that search engines list for the page, when the page has one address to list. */
  canonicalPath?: string | undefined
  /** Keeps the page out of search results: a page that shows an error, or that names nothing that exists. */
  noindex?: boolean
}

/** The address of the path on the host that serves the page. The host is not written in the code. */
const absolute = (path: string): string => new URL(path, globalThis.location.origin).href

/**
 * The title and the meta elements of the page that draws it. React puts them in the head of the document, and removes
 * them when the page goes away.
 */
export const PageMeta = ({ title, description, canonicalPath, noindex = false }: PageMetaProps) => (
  <>
    <title>{title}</title>
    {description !== undefined && <meta name="description" content={description} />}
    {canonicalPath !== undefined && <link rel="canonical" href={absolute(canonicalPath)} />}
    {noindex && <meta name="robots" content="noindex" />}
  </>
)
