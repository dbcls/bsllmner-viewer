import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router"

import { type Patch, readState, type WorkspaceState, writeState } from "~/lib/workspace-state"

export { type HeatmapColor, type Patch, type Tab, TAB_LABELS, TABS, workspaceSearch,type WorkspaceState } from "~/lib/workspace-state"

/** The workspace state read from the URL, and an updater that writes a patch back to it. */
export const useWorkspaceState = (): [WorkspaceState, (patch: Patch) => void] => {
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => readState(params), [params])
  const update = useCallback(
    (patch: Patch) => {
      // The page keeps its scroll position: a change of the condition or of a view redraws the views in place.
      setParams(
        (current) => {
          const next: WorkspaceState = { ...readState(current), ...patch }
          if ("q" in patch && !("page" in patch)) next.page = 1
          return writeState(next)
        },
        { preventScrollReset: true },
      )
    },
    [setParams],
  )
  return [state, update]
}
