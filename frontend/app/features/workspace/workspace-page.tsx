import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation } from "react-router"

import { isInvalidCondition } from "~/lib/api/client"
import { useDataset, useEntries } from "~/lib/api/queries"
import type { TermHit } from "~/lib/api/types"
import { copyText } from "~/lib/export"
import { Alert, Card } from "~/ui"

import { ConditionBar } from "./condition-bar"
import { ConditionPanel } from "./condition-panel"
import { DistributionTab } from "./distribution/distribution-tab"
import { HeatmapTab } from "./heatmap/heatmap-tab"
import { ApiModal, ExportMenu } from "./overlays"
import { ProjectsTab } from "./projects/projects-tab"
import { SamplesTab } from "./samples/samples-tab"
import { useWorkspaceState } from "./state"
import { Tabs } from "./tabs"
import { TermPicker } from "./term-picker/term-picker"
import { TrendTab } from "./trend/trend-tab"
import { useCondition } from "./use-condition"
import { replaceIfCurrent } from "./use-past-end"

/**
 * How long an alert stays. It is at the top of the viewport, away from the control that raised it, so it stays long
 * enough to be found there.
 */
const ALERT_MS = 4000

export const WorkspacePage = () => {
  const [state, update, latest] = useWorkspaceState()
  const location = useLocation()
  const [alert, setAlert] = useState<string | null>(null)
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showAlert = useCallback((message: string) => {
    setAlert(message)
    if (alertTimer.current) clearTimeout(alertTimer.current)
    alertTimer.current = setTimeout(() => setAlert(null), ALERT_MS)
  }, [])

  const condition = useCondition(state.q, update, latest, showAlert)
  // The views are not asked for while the condition cannot be read: the api would refuse every request the same way.
  const broken = Boolean(condition.parseError)
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const [pickerOpen, setPickerOpen] = useState(false)
  const [apiOpen, setApiOpen] = useState(false)
  // Pasted entries of an axis are being resolved. This page outlives the views, so a view that is left and opened again still knows.
  const [replacing, setReplacing] = useState(false)
  const entries = useEntries({ q: state.q, page: 1, perPage: 1 }, !broken)

  useEffect(() => () => {
    if (alertTimer.current) clearTimeout(alertTimer.current)
  }, [])

  const pastEnd = replaceIfCurrent(latest, update)

  const onPick = (hit: TermHit) => {
    void condition.toggle(hit.clauses)
    setPickerOpen(false)
  }

  const share = async () => {
    const ok = await copyText(window.location.href)
    if (!ok) showAlert("Copy failed")
    return ok
  }

  return (
    <>
      <ConditionBar
        q={state.q}
        condition={condition}
        onShare={share}
        onApi={() => setApiOpen(true)}
        exportMenu={<ExportMenu q={state.q} totalEntries={entries.data?.pagination.total} />}
      />
      <div className="flex min-h-0 flex-1 items-stretch">
        <ConditionPanel q={state.q} condition={condition} onAddTerm={() => setPickerOpen(true)} />
        <main className="min-w-0 flex-1 pb-4">
          <Tabs state={state} onTab={(tab) => update({ tab, page: 1 })} />
          <div className="px-workspace-gutter pt-4">
            {broken && (
              <Card padding="lg">
                <p className="text-fs-body-sm text-ink-soft">
                  {isInvalidCondition(condition.parseError) ? "Fix the condition to see results." : "The results are shown when the condition has loaded."}
                </p>
              </Card>
            )}
            {!broken && state.tab === "samples" && (
              <SamplesTab
                state={state}
                onPage={(page) => update({ page })}
                onPastEnd={pastEnd}
                onPerPage={(perPage) => update({ perPage, page: 1 })}
                search={location.search}
              />
            )}
            {!broken && state.tab === "distribution" && (
              <DistributionTab
                state={state}
                condition={condition}
                onUnit={(unit) => update({ unit })}
                onTermIds={() => update({ termIds: !state.termIds })}
              />
            )}
            {!broken && state.tab === "heatmap" && (
              <HeatmapTab
                state={state}
                condition={condition}
                update={update}
                latest={latest}
                replacing={replacing}
                setReplacing={setReplacing}
                onAlert={showAlert}
              />
            )}
            {!broken && state.tab === "trend" && (
              <TrendTab
                state={state}
                condition={condition}
                update={update}
                latest={latest}
                replacing={replacing}
                setReplacing={setReplacing}
                onAlert={showAlert}
              />
            )}
            {!broken && state.tab === "projects" && (
              <ProjectsTab
                state={state}
                condition={condition}
                onPage={(page) => update({ page })}
                onPastEnd={pastEnd}
                onSort={(sort) => update({ sort, page: 1 })}
                onPerPage={(perPage) => update({ perPage, page: 1 })}
              />
            )}
          </div>
        </main>
      </div>
      <TermPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        fields={fields}
        q={state.q}
        isSelected={(hit) => condition.isSelected(hit.clauses)}
        onPick={onPick}
      />
      <ApiModal
        open={apiOpen}
        onClose={() => setApiOpen(false)}
        state={state}
        onAlert={showAlert}
      />
      <Alert message={alert} />
    </>
  )
}
