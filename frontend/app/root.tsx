import "@fontsource/public-sans/400.css"
import "@fontsource/public-sans/500.css"
import "@fontsource/public-sans/600.css"
import "@fontsource/public-sans/700.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "./styles/tailwind.css"

import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router"

import { queryClient } from "~/lib/query-client"
import { ShellLayout } from "~/shell"
import { Button, Card, PageHeading } from "~/ui"

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

const ErrorBoundaryContent = () => {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "Something went wrong."

  return (
    <section className="mx-auto w-full max-w-content-max px-page-gutter py-8">
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
    </section>
  )
}

export const ErrorBoundary = () => (
  <QueryClientProvider client={queryClient}>
    <ShellLayout>
      <ErrorBoundaryContent />
    </ShellLayout>
  </QueryClientProvider>
)
