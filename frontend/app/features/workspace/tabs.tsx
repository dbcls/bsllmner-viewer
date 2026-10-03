import { Link } from "react-router"

import { cn } from "~/ui"

import { TAB_LABELS, TABS, workspaceSearch, type WorkspaceState } from "./state"

/** The row of view tabs. It only switches views; the controls of a view are in the view. */
export const Tabs = ({ state }: { state: WorkspaceState }) => (
  <div className="flex items-end justify-between border-b border-border-soft bg-surface px-workspace-gutter">
    <nav className="flex gap-0.5" aria-label="Views">
      {TABS.map((tab) => {
        const active = tab === state.tab
        return (
          <Link
            key={tab}
            to={`/entries${workspaceSearch({ ...state, tab, page: 1 })}`}
            preventScrollReset
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
