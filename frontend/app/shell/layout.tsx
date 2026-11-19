import type { ReactNode } from "react"

import { Footer } from "./footer"
import { Header } from "./header"
import { SHELL_FRAME_ID } from "./page-change"

/**
 * The frame of every page: the skip link, the header, and the footer around the page. The build writes the frame into
 * the HTML around an empty page. The root layout draws the frame around the placeholder of the HTML and around the
 * page, so the app keeps the elements of the HTML when it draws the page, and a link of the frame that has the focus
 * before the JavaScript runs keeps the focus. The frame takes the focus when another page opens (`PageChange`), without
 * a ring around the page.
 */
export const ShellLayout = ({ children }: { children?: ReactNode }) => (
  <div
    id={SHELL_FRAME_ID}
    tabIndex={-1}
    className="flex min-h-screen min-w-content-max flex-col bg-surface-subtle text-fs-body leading-normal text-ink outline-none focus-visible:rounded-none focus-visible:shadow-none"
  >
    <a
      href="#main"
      className="sr-only rounded-button border border-border-soft bg-surface px-3 py-1.5 text-fs-body-sm font-semibold text-ink focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-tooltip"
    >
      Skip to main content
    </a>
    <Header />
    <div className="flex flex-1 flex-col">{children}</div>
    <Footer />
  </div>
)
