import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react"

import { buttonClass } from "./button"
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

/** Text that acts as a button: "+ Add", "Clear all", "Export". */
export const LinkButton = ({ children, tone = "brand", mono, size = "sm", icon, type = "button", ...rest }: LinkButtonProps) => (
  <button
    {...rest}
    type={type}
    className={cn(
      "cursor-pointer whitespace-nowrap enabled:hover:text-brand-deep disabled:cursor-not-allowed disabled:opacity-55",
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
  /** `inline` is a link in a sentence, underlined so that it is told apart from the text around it by more than its color. */
  kind?: "text" | "inline" | "button"
  /**
   * A glyph before the text that names where the link goes, such as the GitHub mark. A link with one does not also show
   * the new-tab icon after its text: the button is told apart by its own glyph.
   */
  icon?: IconName
}

/**
 * A link to another site, opened in a new tab. Unless it has its own glyph, an icon after its text says so. The link is
 * the containing block of its hidden note (`relative`), so that a link in a scrolling table does not widen the page.
 */
export const ExternalLink = ({ children, kind = "text", icon, ...rest }: ExternalLinkProps) => (
  <a
    {...rest}
    target="_blank"
    rel="noreferrer"
    onClick={(event) => event.stopPropagation()}
    className={cn(
      "relative",
      kind !== "button" && "text-brand hover:text-brand-deep",
      kind === "inline" && "underline underline-offset-2",
      kind === "button" && buttonClass("secondary", "sm"),
    )}
  >
    {icon && <Icon name={icon} className={kind === "button" ? undefined : "mr-1"} />}
    {kind === "button" ? <span className="text-trim-cap">{children}</span> : children}
    {!icon && <Icon name={ACTION_ICON.openInNewTab} size="sm" className={kind === "button" ? undefined : "ml-1"} />}
    <span className="sr-only">(opens in a new tab)</span>
  </a>
)
