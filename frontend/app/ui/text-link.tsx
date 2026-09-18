import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "./cn"

type LinkButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  children: ReactNode
  tone?: "brand" | "soft"
  mono?: boolean
  size?: "sm" | "md"
}

/** Text that acts as a button: "+ Add", "Clear all", "TSV". */
export const LinkButton = ({ children, tone = "brand", mono, size = "sm", type = "button", ...rest }: LinkButtonProps) => (
  <button
    {...rest}
    type={type}
    className={cn(
      "cursor-pointer whitespace-nowrap hover:text-brand-deep",
      tone === "brand" ? "text-brand" : "text-ink-soft",
      mono && "font-mono",
      size === "sm" ? "text-fs-label" : "text-fs-body-sm",
    )}
  >
    {children}
  </button>
)

type ExternalLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "target" | "rel"> & {
  children: ReactNode
  kind?: "text" | "button"
}

/** A link to another site, opened in a new tab. */
export const ExternalLink = ({ children, kind = "text", ...rest }: ExternalLinkProps) => (
  <a
    {...rest}
    target="_blank"
    rel="noreferrer"
    onClick={(event) => event.stopPropagation()}
    className={cn(
      kind === "text" && "text-brand hover:text-brand-deep",
      kind === "button" &&
        "inline-block rounded-button border border-border-soft bg-surface px-3 py-1.5 text-fs-body-sm text-ink-mid hover:bg-brand-soft",
    )}
  >
    {children}
  </a>
)
