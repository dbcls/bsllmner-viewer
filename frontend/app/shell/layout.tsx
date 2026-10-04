import type { ReactNode } from "react"

import { Footer, FooterFallback } from "./footer"
import { Header } from "./header"
import { SHELL_FRAME_ID } from "./page-change"

/** The frame of every page. It takes the focus when another page opens (`PageChange`), without a ring around the page. */
const ShellFrame = ({ footer, children }: { footer: ReactNode; children?: ReactNode }) => (
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
    {footer}
  </div>
)

type ShellLayoutProps = {
  children: ReactNode
}

export const ShellLayout = ({ children }: ShellLayoutProps) => <ShellFrame footer={<Footer />}>{children}</ShellFrame>

/**
 * The shell with an empty page. The build writes the shell into the HTML, and the browser shows the shell until the
 * JavaScript runs. The shell does not call the api, so the footer shows a placeholder where the dataset line goes.
 */
export const ShellFallback = () => <ShellFrame footer={<FooterFallback />} />
