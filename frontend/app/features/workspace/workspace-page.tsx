import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation } from "react-router"

import { useDataset, useEntries } from "~/lib/api/queries"
import type { Clause, TermHit } from "~/lib/api/types"
import { copyText } from "~/lib/export"
import { fieldLabel } from "~/lib/labels"
import { Toast } from "~/ui"

import { ConditionBar } from "./condition-bar"
import { ConditionPanel } from "./condition-panel"
import { DistributionTab } from "./distribution/distribution-tab"
import { type AxisSide, HeatmapTab } from "./heatmap/heatmap-tab"
import { ApiModal, ExportMenu } from "./overlays"
import { ProjectsTab } from "./projects/projects-tab"
import { SamplesTab } from "./samples/samples-tab"
import { useWorkspaceState } from "./state"
import { Tabs } from "./tabs"
import { ALL_FIELDS, type PickerMode, type PickerRequest, TermPicker } from "./term-picker/term-picker"
import { TrendTab } from "./trend/trend-tab"
import { useCondition } from "./use-condition"

const AXIS_DIMENSIONS = ["library_strategy", "organism_id", "date_published"]

export const WorkspacePage = () => {
  const [state, update] = useWorkspaceState()
  const location = useLocation()
  const condition = useCondition(state.q, update)
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const [picker, setPicker] = useState<PickerRequest | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [apiOpen, setApiOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const entries = useEntries({ q: state.q, page: 1, perPage: 1 })
  const axisElements = useRef<Record<AxisSide, string[]>>({ row: [], col: [] })
  const onAxisElements = useCallback((side: AxisSide, values: string[]) => {
    axisElements.current[side] = values
  }, [])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const dimensions = [...fields, ...AXIS_DIMENSIONS].map((d) => ({ value: d, label: fieldLabel(d) }))

  const axisTerms = (mode: PickerMode) => (mode === "row" ? state.rowTerms : state.colTerms)
  const setAxisTerms = (mode: PickerMode, terms: string[] | null) =>
    update(mode === "row" ? { rowTerms: terms } : { colTerms: terms })

  const onPick = (mode: PickerMode, _field: string, hit: TermHit, clauses: Clause[]) => {
    if (mode === "condition") {
      void condition.toggle(clauses)
      setPicker(null)
      return
    }
    const current = axisTerms(mode) ?? axisElements.current[mode as AxisSide]
    const next = current.includes(hit.termId) ? current.filter((t) => t !== hit.termId) : [...current, hit.termId]
    setAxisTerms(mode, next)
  }

  const onPickerField = (mode: PickerMode, field: string) => {
    if (mode === "row") update({ row: field, rowTerms: null })
    else if (mode === "col") update({ col: field, colTerms: null })
  }

  const isPicked = (mode: PickerMode, _field: string, hit: TermHit) =>
    mode === "condition" ? condition.isSelected(hit.clauses) : (axisTerms(mode) ?? axisElements.current[mode as AxisSide]).includes(hit.termId)

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
        <ConditionPanel q={state.q} condition={condition} onAddTerm={() => setPicker({ field: ALL_FIELDS, mode: "condition" })} />
        <main className="min-w-0 flex-1 pb-4">
          <Tabs state={state} />
          <div className="px-workspace-gutter pt-4">
            {state.tab === "samples" && (
              <SamplesTab state={state} onPage={(page) => update({ page })} search={location.search} />
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
                onOpenPicker={(side, field) => setPicker({ field, mode: side })}
                onAxisElements={onAxisElements}
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
              <ProjectsTab state={state} condition={condition} onPage={(page) => update({ page })} onSort={(sort) => update({ sort, page: 1 })} />
            )}
          </div>
        </main>
      </div>
      <TermPicker
        request={picker}
        onClose={() => setPicker(null)}
        fields={fields}
        dimensions={dimensions}
        q={state.q}
        isSelected={isPicked}
        onPick={onPick}
        onField={onPickerField}
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
