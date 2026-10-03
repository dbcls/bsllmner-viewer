import type { ReactNode } from "react"

import { Footer, FooterFallback } from "./footer"
import { Header } from "./header"

const ShellFrame = ({ footer, children }: { footer: ReactNode; children?: ReactNode }) => (
  <div className="flex min-h-screen min-w-content-max flex-col bg-surface-subtle text-fs-body leading-normal text-ink">
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
 * The shell with an empty page, drawn into the HTML when the app is built and shown until the JavaScript runs. It asks
 * nothing of the api, so the footer keeps the place of the dataset line.
 */
export const ShellFallback = () => <ShellFrame footer={<FooterFallback />} />
