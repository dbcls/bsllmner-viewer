import { useContext, useEffect, useState } from "react"
import { UNSAFE_NavigationContext, useLocation } from "react-router"

/** The id of the frame of the shell, which takes the focus when another page opens. */
export const SHELL_FRAME_ID = "shell"

/**
 * How long the live region waits before it reads the title. The region is drawn again with the root layout when the
 * error page comes or goes, and a screen reader may miss a change of a region that it has not seen yet.
 */
const ANNOUNCE_DELAY_MS = 100

/**
 * The path of the page shown last, for each router. It is kept outside the component, because the router draws the root
 * layout again, and this component with it, when the error page takes the place of a page or gives it back. The key is
 * the navigator of the router, which must stay the same object for as long as the router lives: with a new object at
 * every render, no page would seem to change, and the focus and the live region would stop without an error.
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
    // Not cancelled when the effect runs again: the page has changed once, whatever runs the effect twice.
    setTimeout(() => setAnnouncement(document.title), ANNOUNCE_DELAY_MS)
  }, [navigator, pathname])

  return (
    <div role="status" className="sr-only">
      {announcement}
    </div>
  )
}
