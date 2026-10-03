import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation } from "react-router"

import { useDataset, useEntries } from "~/lib/api/queries"
import type { TermHit } from "~/lib/api/types"
import { copyText } from "~/lib/export"
import { Toast } from "~/ui"

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

export const WorkspacePage = () => {
  const [state, update] = useWorkspaceState()
  const location = useLocation()
  const condition = useCondition(state.q, update)
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const [pickerOpen, setPickerOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [apiOpen, setApiOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const entries = useEntries({ q: state.q, page: 1, perPage: 1 })

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const onPick = (hit: TermHit) => {
    void condition.toggle(hit.clauses)
    setPickerOpen(false)
  }

  const share = async () => {
    const ok = await copyText(window.location.href)
    if (!ok) showToast("Copy failed")
    return ok
  }

  return (
    <>
      <ConditionBar
        q={state.q}
        condition={condition}
        onShare={share}
        onExport={() => setExportOpen((open) => !open)}
        onApi={() => setApiOpen(true)}
        exportMenu={<ExportMenu open={exportOpen} onClose={() => setExportOpen(false)} q={state.q} totalEntries={entries.data?.pagination.total} />}
      />
      <div className="flex min-h-0 flex-1 items-stretch">
        <ConditionPanel q={state.q} condition={condition} onAddTerm={() => setPickerOpen(true)} />
        <main className="min-w-0 flex-1 pb-4">
          <Tabs state={state} />
          <div className="px-workspace-gutter pt-4">
            {state.tab === "samples" && (
              <SamplesTab state={state} onPage={(page) => update({ page })} onPerPage={(perPage) => update({ perPage, page: 1 })} search={location.search} />
            )}
            {state.tab === "distribution" && (
              <DistributionTab
                state={state}
                condition={condition}
                onUnit={(unit) => update({ unit })}
              />
            )}
            {state.tab === "heatmap" && (
              <HeatmapTab
                state={state}
                condition={condition}
                update={update}
                onToast={showToast}
              />
            )}
            {state.tab === "trend" && (
              <TrendTab
                state={state}
                condition={condition}
                onSplit={(field) => update({ trendField: field, trendTerms: null })}
                onUnit={(unit) => update({ unit })}
              />
            )}
            {state.tab === "projects" && (
              <ProjectsTab
                state={state}
                condition={condition}
                onPage={(page) => update({ page })}
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
        onToast={showToast}
      />
      <Toast message={toast} />
    </>
  )
}
