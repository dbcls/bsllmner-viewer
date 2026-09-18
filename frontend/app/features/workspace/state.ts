import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router"

import { type Patch, readState, type WorkspaceState, writeState } from "~/lib/workspace-state"

export { DEFAULTS, type HeatmapColor, type Patch, type Tab, TABS, workspaceSearch,type WorkspaceState } from "~/lib/workspace-state"

/** The workspace state read from the URL, and an updater that writes a patch back to it. */
export const useWorkspaceState = (): [WorkspaceState, (patch: Patch) => void] => {
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => readState(params), [params])
  const update = useCallback(
    (patch: Patch) => {
      setParams((current) => {
        const next: WorkspaceState = { ...readState(current), ...patch }
        if ("q" in patch && !("page" in patch)) next.page = 1
        return writeState(next)
      })
    },
    [setParams],
  )
  return [state, update]
}
