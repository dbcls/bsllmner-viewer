import type { ReactNode } from "react"

import { Footer } from "./footer"
import { Header } from "./header"

type ShellLayoutProps = {
  children: ReactNode
}

export const ShellLayout = ({ children }: ShellLayoutProps) => (
  <div className="flex min-h-screen min-w-content-max flex-col bg-surface-subtle text-fs-body leading-normal text-ink">
    <Header />
    <div className="flex flex-1 flex-col">{children}</div>
    <Footer />
  </div>
)
