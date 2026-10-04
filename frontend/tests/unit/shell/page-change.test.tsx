import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { act, type ReactNode } from "react"
import { createMemoryRouter, Link, MemoryRouter, Outlet, Route, RouterProvider, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  // The footer asks for the dataset, which stays on its way: the tests look at the focus and the title only.
  const GET = () => new Promise(() => undefined)
  return { ...original, api: { ...original.api, GET } }
})

import { PageChange, ShellLayout } from "~/shell"
import { PageMeta } from "~/ui"

// The AbortSignal of jsdom is not the one of undici: without it the data router can build its requests.
const NativeRequest = globalThis.Request
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const { signal: _signal, ...rest } = init ?? {}
    super(input, rest)
  }
}

const Page = ({ title }: { title: string }) => (
  <main id="main">
    <PageMeta title={title} />
    <Link to="/">Open the first page</Link>
    <Link to="/other">Open the other page</Link>
    <Link to="/other?view=2">Change the search</Link>
    <Link to="/nope">Open a page that does not exist</Link>
  </main>
)

/** The pages of the app: routes in one shell, with one `PageChange` after them, as in the root layout. */
const renderPages = () =>
  renderWithQuery(
    <MemoryRouter initialEntries={["/"]}>
      <ShellLayout>
        <Routes>
          <Route path="/" element={<Page title="First page" />} />
          <Route path="/other" element={<Page title="Other page" />} />
        </Routes>
      </ShellLayout>
      <PageChange />
    </MemoryRouter>,
  )

/**
 * A data router whose root route draws its pages and its error page each in a root layout of its own, with a shell and
 * a `PageChange`, as the root route of the app does. The router draws the root layout again between a page and the
 * error page.
 */
const renderWithErrorPage = () => {
  const RootLayout = ({ children }: { children: ReactNode }) => (
    <>
      <ShellLayout>{children}</ShellLayout>
      <PageChange />
    </>
  )
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <RootLayout>
            <Outlet />
          </RootLayout>
        ),
        errorElement: (
          <RootLayout>
            <Page title="Not Found" />
          </RootLayout>
        ),
        children: [
          { index: true, element: <Page title="First page" /> },
          { path: "other", element: <Page title="Other page" /> },
        ],
      },
    ],
    { initialEntries: ["/"] },
  )
  renderWithQuery(<RouterProvider router={router} />)
  return router
}

/** The frame of the shell: the element that holds the skip link, the header, the page, and the footer. */
const frame = () => {
  const element = screen.getByText("Skip to main content").parentElement
  if (!element) throw new Error("no frame")
  return element
}

const status = () => screen.getByRole("status")

describe("PageChange between the pages", () => {
  it("leaves the focus and says nothing when the first page opens", () => {
    renderPages()
    expect(document.activeElement).toBe(document.body)
    expect(status()).toHaveTextContent("")
  })

  it("moves the focus to the top of the frame and reads the title of the new page, there and back", async () => {
    const user = userEvent.setup()
    renderPages()
    await user.click(screen.getByRole("link", { name: "Open the other page" }))
    expect(document.activeElement).toBe(frame())
    await waitFor(() => expect(status()).toHaveTextContent("Other page"))
    await user.click(screen.getByRole("link", { name: "Open the first page" }))
    await waitFor(() => expect(status()).toHaveTextContent("First page"))
    expect(document.activeElement).toBe(frame())
  })

  it("brings the skip link with the next Tab, as a page load does", async () => {
    const user = userEvent.setup()
    renderPages()
    await user.click(screen.getByRole("link", { name: "Open the other page" }))
    expect(document.activeElement).toBe(frame())
    await user.tab()
    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveFocus()
  })

  it("keeps the focus where it is when only the search parameters change", async () => {
    const user = userEvent.setup()
    renderPages()
    await user.click(screen.getByRole("link", { name: "Open the other page" }))
    await waitFor(() => expect(status()).toHaveTextContent("Other page"))
    const searchLink = screen.getByRole("link", { name: "Change the search" })
    await user.click(searchLink)
    expect(searchLink).toHaveFocus()
    expect(status()).toHaveTextContent("Other page")
  })
})

describe("PageChange between a page and the error page, which the router draws in a root layout of its own", () => {
  it("leaves the focus and says nothing when the first page opens", () => {
    renderWithErrorPage()
    expect(document.activeElement).toBe(document.body)
    expect(status()).toHaveTextContent("")
  })

  it("moves the focus to the top of the frame and reads the title, from a page to the error page and back", async () => {
    const user = userEvent.setup()
    renderWithErrorPage()
    await user.click(screen.getByRole("link", { name: "Open a page that does not exist" }))
    await waitFor(() => expect(status()).toHaveTextContent("Not Found"))
    expect(document.activeElement).toBe(frame())
    await user.click(screen.getByRole("link", { name: "Open the first page" }))
    await waitFor(() => expect(status()).toHaveTextContent("First page"))
    expect(document.activeElement).toBe(frame())
  })

  it("does the same when the browser goes back and forward", async () => {
    const user = userEvent.setup()
    const router = renderWithErrorPage()
    await user.click(screen.getByRole("link", { name: "Open a page that does not exist" }))
    await waitFor(() => expect(status()).toHaveTextContent("Not Found"))
    await act(() => router.navigate(-1))
    await waitFor(() => expect(status()).toHaveTextContent("First page"))
    expect(document.activeElement).toBe(frame())
    await act(() => router.navigate(1))
    await waitFor(() => expect(status()).toHaveTextContent("Not Found"))
    expect(document.activeElement).toBe(frame())
  })
})
