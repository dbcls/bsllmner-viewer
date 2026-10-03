import "@fontsource/public-sans/400.css"
import "@fontsource/public-sans/500.css"
import "@fontsource/public-sans/600.css"
import "@fontsource/public-sans/700.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "@fontsource/ibm-plex-mono/600.css"
import "@fontsource/ibm-plex-mono/700.css"
import "./styles/tailwind.css"

import plexMono400 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url"
import plexMono500 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url"
import publicSans400 from "@fontsource/public-sans/files/public-sans-latin-400-normal.woff2?url"
import publicSans600 from "@fontsource/public-sans/files/public-sans-latin-600-normal.woff2?url"
import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import {
  isRouteErrorResponse,
  Link,
  Links,
  type LinksFunction,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router"

import { queryClient } from "~/lib/query-client"
import { ShellFallback, ShellLayout } from "~/shell"
import { Button, Card, PageHeading } from "~/ui"

/**
 * The faces that every page draws first: the text and the numbers (Public Sans 400 and IBM Plex Mono 400) and the header
 * (Public Sans 600 and the IBM Plex Mono 500 of the wordmark). The page asks for them with its HTML, instead of after the
 * JavaScript draws the page and its fallback text has been shown.
 */
export const links: LinksFunction = () =>
  [publicSans400, publicSans600, plexMono400, plexMono500].map((href) => ({ rel: "preload", href, as: "font", type: "font/woff2", crossOrigin: "anonymous" }))

export const Layout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>bsllmner-viewer</title>
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <Meta />
      <Links />
    </head>
    <body>
      {children}
      <ScrollRestoration />
      <Scripts />
    </body>
  </html>
)

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  </QueryClientProvider>
)

export default App

/** The page that the built HTML shows until the JavaScript runs: the header and the footer around an empty page. */
export const HydrateFallback = ShellFallback

const ErrorBoundaryContent = () => {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "Something went wrong."

  return (
    <main id="main" className="mx-auto w-full max-w-content-max px-page-gutter py-4">
      <Card padding="lg">
        <PageHeading>{message}</PageHeading>
        <div className="mt-4">
          {notFound ? (
            <Link to="/" className="text-fs-body-sm text-brand hover:text-brand-deep">
              Go to the top page
            </Link>
          ) : (
            <Button kind="secondary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
        </div>
      </Card>
    </main>
  )
}

export const ErrorBoundary = () => (
  <QueryClientProvider client={queryClient}>
    <ShellLayout>
      <ErrorBoundaryContent />
    </ShellLayout>
  </QueryClientProvider>
)
