/**
 * The icons the app draws, as inline SVG. The outlines are Lucide's (ISC, © Lucide Contributors); the GitHub mark is
 * GitHub's.
 *
 * An icon has no meaning of its own: every glyph is `aria-hidden`, so a control that shows only an icon names itself
 * with its own label. A screen does not pick a glyph by name. It picks the action that a control does (`ACTION_ICON`),
 * so the same action is drawn the same way everywhere. Icons mark actions only, not kinds of things.
 */

import type { ReactNode } from "react"

import { cn } from "./cn"

export type IconName =
  | "search"
  | "close"
  | "chevron-right"
  | "chevron-down"
  | "external"
  | "github"
  | "braces"
  | "copy"
  | "check"
  | "download"
  | "app-window"

const NODES: Record<IconName, ReactNode> = {
  "search": (
    <>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </>
  ),
  "close": (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "github": (
    <path
      fill="currentColor"
      stroke="none"
      d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.69-3.88-1.54-3.88-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.7 5.4-5.27 5.69.41.35.78 1.03.78 2.08 0 1.5-.01 2.71-.01 3.08 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"
    />
  ),
  "braces": (
    <>
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
    </>
  ),
  "external": (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  "copy": (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  "check": <path d="M20 6 9 17l-5-5" />,
  "download": (
    <>
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </>
  ),
  "app-window": (
    <>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
    </>
  ),
}

export const ICON_NAMES = Object.keys(NODES) as IconName[]

/** The glyph of a kind of action, wherever a control does it. */
export const ACTION_ICON = {
  search: "search",
  clear: "close",
  goTo: "chevron-right",
  openList: "chevron-down",
  openInNewTab: "external",
  openRepository: "github",
  openApiDocs: "braces",
  copy: "copy",
  copied: "check",
  download: "download",
  openDialog: "app-window",
} as const satisfies Record<string, IconName>

type IconProps = {
  name: IconName
  /** `md` is a little larger than the text beside it; `sm` is a little smaller, for a mark after a link. Both follow the font size. */
  size?: "sm" | "md"
  /** Margin and color only; the size comes from `size`. */
  className?: string | undefined
}

export const Icon = ({ name, size = "md", className }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={cn("inline-block shrink-0", size === "md" ? "size-[1.1em] align-[-0.15em]" : "size-[0.85em] align-[-0.1em]", className)}
  >
    {NODES[name]}
  </svg>
)
