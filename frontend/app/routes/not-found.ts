import { data } from "react-router"

/**
 * Every path that no other route matches. The route throws a 404 response from its client loader, so that the root's
 * ErrorBoundary draws the not found page. A path that matches no route at all draws the ErrorBoundary in the first
 * render, which differs from the HydrateFallback of the built HTML. A route with a client loader draws the
 * HydrateFallback in the first render, as the built HTML does.
 */
export const clientLoader = () => {
  throw data(null, { status: 404, statusText: "Not Found" })
}
