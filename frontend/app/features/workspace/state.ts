import { useCallback, useLayoutEffect, useMemo, useRef } from "react"
import { useSearchParams } from "react-router"

import { type Patch, readState, type WorkspaceState, writeState } from "~/lib/workspace-state"

export { type HeatmapColor, type Patch, type Tab, TAB_LABELS, TABS, workspaceSearch,type WorkspaceState } from "~/lib/workspace-state"

/** Writes a patch to the URL. */
export type Update = (patch: Patch) => void

/**
 * The workspace state read from the URL, an updater that writes a patch back to it, and a reader of the latest state.
 * Every write starts from the latest URL, not from the URL of the render that made the updater, so that a write after an
 * await does not undo a change made while it waited.
 */
export const useWorkspaceState = (): [WorkspaceState, Update, () => WorkspaceState] => {
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => readState(params), [params])
  const latestParams = useRef(params)
  // A render that was not committed does not move the latest URL, and a render of the params of an earlier navigation
  // does not replace what an update wrote after it, as the params change only when the router commits a location.
  useLayoutEffect(() => {
    latestParams.current = params
  }, [params])
  const latest = useCallback(() => readState(latestParams.current), [])
  const update = useCallback<Update>(
    (patch) => {
      const next: WorkspaceState = { ...readState(latestParams.current), ...patch }
      // The page keeps its scroll position: a change of the condition or of a view redraws the views in place.
      if ("q" in patch && !("page" in patch)) next.page = 1
      const written = writeState(next)
      // A patch that changes nothing does not add a history entry.
      if (written.toString() === latestParams.current.toString()) return
      latestParams.current = written
      setParams(latestParams.current, { preventScrollReset: true })
    },
    [setParams],
  )
  return [state, update, latest]
}
