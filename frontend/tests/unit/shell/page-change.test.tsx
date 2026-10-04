import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { act, type ReactNode,StrictMode } from "react"
import { createMemoryRouter, Link, MemoryRouter, Outlet, Route, RouterProvider, Routes, useSearchParams } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  // The footer requests the dataset, and this mock never answers. The tests check only the focus and the title.
  const GET = () => new Promise(() => undefined)
  return { ...original, api: { ...original.api, GET } }
})

import { PageChange, ShellLayout } from "~/shell"
import { PageMeta } from "~/ui"

// The data router builds each Request with the AbortSignal of jsdom. The Request of Node (undici) accepts only its own
// AbortSignal and throws a TypeError. The Request class below drops the signal, so the data router can build its requests.
const NativeRequest = globalThis.Request
beforeEach(() => {
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        const { signal: _signal, ...rest } = init ?? {}
        super(input, rest)
      }
    },
  )
})

/** A page whose title also names the `view` search parameter, as a page whose title follows its search does. */
const Page = ({ title }: { title: string }) => {
  const [search] = useSearchParams()
  const view = search.get("view")
  return <PageBody title={view === null ? title : `${title}, view ${view}`} />
}

const PageBody = ({ title }: { title: string }) => (
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
const renderWithErrorPage = (strict = false) => {
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
  const provider = <RouterProvider router={router} />
  renderWithQuery(strict ? <StrictMode>{provider}</StrictMode> : provider)
  return router
}

/** The frame of the shell: the element that holds the skip link, the header, the page, and the footer. */
const frame = () => {
  const element = screen.getByText("Skip to main content").parentElement
  if (!element) throw new Error("no frame")
  return element
}

const status = () => screen.getByRole("status")

/** Waits longer than the delay with which `PageChange` writes the title. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 200)))

describe("PageChange between the pages", () => {
  it("leaves the focus and says nothing when the first page opens", async () => {
    renderPages()
    await settle()
    expect(document.activeElement).toBe(document.body)
    expect(status().textContent).toBe("")
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
    await settle()
    expect(document.title).toBe("Other page, view 2")
    expect(searchLink).toHaveFocus()
    expect(status().textContent).toBe("Other page")
  })
})

describe("PageChange between a page and the error page, which the router draws in a root layout of its own", () => {
  it("leaves the focus and says nothing when the first page opens", async () => {
    renderWithErrorPage()
    await settle()
    expect(document.activeElement).toBe(document.body)
    expect(status().textContent).toBe("")
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

  it("moves the focus to the top of the frame and reads the title after Back and Forward in the browser", async () => {
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

describe("PageChange in StrictMode, which runs the effects of a new layout twice", () => {
  it("leaves the first page alone and reads the title once the error page draws a new root layout", async () => {
    const user = userEvent.setup()
    renderWithErrorPage(true)
    await settle()
    expect(document.activeElement).toBe(document.body)
    expect(status().textContent).toBe("")
    await user.click(screen.getByRole("link", { name: "Open a page that does not exist" }))
    await waitFor(() => expect(status().textContent).toBe("Not Found"))
    expect(document.activeElement).toBe(frame())
    await user.click(screen.getByRole("link", { name: "Open the first page" }))
    await waitFor(() => expect(status().textContent).toBe("First page"))
    expect(document.activeElement).toBe(frame())
  })
})
