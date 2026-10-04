import { useContext, useEffect, useState } from "react"
import { UNSAFE_NavigationContext, useLocation } from "react-router"

/** The id of the frame of the shell, which takes the focus when another page opens. */
export const SHELL_FRAME_ID = "shell"

/**
 * How long the live region waits before it reads the title. The root layout renders the region again when the error page
 * appears or disappears. A screen reader can miss a change in a region that is new to it, so the title is announced
 * after a short delay.
 */
const ANNOUNCE_DELAY_MS = 100

/**
 * The path of the page shown last, for each router. The map is outside the component because the root layout, and this
 * component with it, is rendered again when the error page replaces a page or the page returns. The key is the navigator
 * of the router. The navigator must stay the same object while the router exists. If the navigator changes on every
 * render, no page change is detected, and the focus and the live region stop working without an error.
 */
const shownPaths = new WeakMap<object, string>()

/**
 * When another page opens, the focus moves to the top of the frame of the shell and a live region reads the title of the
 * new page, as a page load would. The next Tab reaches the skip link. A change of the search parameters alone, such as a
 * change of the condition or of the view of the workspace, keeps the focus where it is, and so does the first page.
 */
export const PageChange = () => {
  const { pathname } = useLocation()
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const [announcement, setAnnouncement] = useState("")

  useEffect(() => {
    const shown = shownPaths.get(navigator)
    shownPaths.set(navigator, pathname)
    if (shown === undefined || shown === pathname) return
    document.getElementById(SHELL_FRAME_ID)?.focus({ preventScroll: true })
    // Do not cancel the timer in a cleanup. If React runs the effect twice (as in StrictMode), the second run returns
    // early, so the first run must announce the title.
    setTimeout(() => setAnnouncement(document.title), ANNOUNCE_DELAY_MS)
  }, [navigator, pathname])

  return (
    <div role="status" className="sr-only">
      {announcement}
    </div>
  )
}
