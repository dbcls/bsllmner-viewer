import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react"

type ClickableProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  children: ReactNode
}

/** A button styled by its caller: rows, bars, and cells that act on click. */
export const Clickable = ({ children, ...rest }: ClickableProps) => (
  <button {...rest} type="button">
    {children}
  </button>
)

type DownloadLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "download"> & {
  children: ReactNode
}

/** A link that downloads its target. */
export const DownloadLink = ({ children, ...rest }: DownloadLinkProps) => (
  <a {...rest} download>
    {children}
  </a>
)
