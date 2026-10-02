import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "./cn"
import { ACTION_ICON, Icon, type IconName } from "./icons"

type LinkButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  children: ReactNode
  tone?: "brand" | "soft"
  mono?: boolean
  size?: "sm" | "md"
  /** The glyph of the action, before the text. */
  icon?: IconName
}

/** Text that acts as a button: "+ Add", "Clear all", "TSV". */
export const LinkButton = ({ children, tone = "brand", mono, size = "sm", icon, type = "button", ...rest }: LinkButtonProps) => (
  <button
    {...rest}
    type={type}
    className={cn(
      "cursor-pointer whitespace-nowrap hover:text-brand-deep",
      icon && "inline-flex items-center gap-1",
      tone === "brand" ? "text-brand" : "text-ink-soft",
      mono && "font-mono",
      size === "sm" ? "text-fs-label" : "text-fs-body-sm",
    )}
  >
    {icon && <Icon name={icon} />}
    {children}
  </button>
)

type ExternalLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "target" | "rel"> & {
  children: ReactNode
  kind?: "text" | "button"
  /**
   * A glyph before the text that names where the link goes, such as the GitHub mark. A link with one does not also show
   * the new-tab icon after its text: the button is told apart by its own glyph.
   */
  icon?: IconName
}

/** A link to another site, opened in a new tab. Unless it has its own glyph, an icon after its text says so. */
export const ExternalLink = ({ children, kind = "text", icon, ...rest }: ExternalLinkProps) => (
  <a
    {...rest}
    target="_blank"
    rel="noreferrer"
    onClick={(event) => event.stopPropagation()}
    className={cn(
      kind === "text" && "text-brand hover:text-brand-deep",
      kind === "button" &&
        "inline-flex items-center gap-1.5 rounded-button border border-border-soft bg-surface px-3 py-1.5 text-fs-body-sm leading-none font-semibold text-ink hover:bg-brand-soft",
    )}
  >
    {icon && <Icon name={icon} className={kind === "text" ? "mr-1" : undefined} />}
    {children}
    {!icon && <Icon name={ACTION_ICON.openInNewTab} size="sm" className={kind === "text" ? "ml-1" : undefined} />}
    <span className="sr-only">(opens in a new tab)</span>
  </a>
)
