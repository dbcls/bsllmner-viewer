import type { MouseEvent } from "react"
import { Link } from "react-router"

import { cn } from "~/ui"

import { type Tab, TAB_LABELS, TABS, workspaceSearch, type WorkspaceState } from "./state"

/** Whether a click is a plain one that the page handles; a modified click or a click of another button opens the link as the browser does. */
const isPlainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

/**
 * The row of view tabs. It only switches views; the controls of a view are in the view. A plain click writes the tab to the
 * latest URL, as the link of a render can lack a change that was written after it.
 */
export const Tabs = ({ state, onTab }: { state: WorkspaceState; onTab: (tab: Tab) => void }) => (
  <div className="flex items-end justify-between border-b border-border-soft bg-surface px-workspace-gutter">
    <nav className="flex gap-0.5" aria-label="Views">
      {TABS.map((tab) => {
        const active = tab === state.tab
        return (
          <Link
            key={tab}
            to={`/entries${workspaceSearch({ ...state, tab, page: 1 })}`}
            preventScrollReset
            onClick={(event) => {
              if (!isPlainClick(event)) return
              event.preventDefault()
              onTab(tab)
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3.5 pt-3 pb-2.5 text-fs-body no-underline hover:text-brand-deep",
              active ? "border-brand font-semibold text-brand" : "border-transparent text-ink-mid",
            )}
          >
            {TAB_LABELS[tab]}
          </Link>
        )
      })}
    </nav>
  </div>
)
