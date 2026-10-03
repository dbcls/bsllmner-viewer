import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef } from "react"

import { cacheParsedCondition, parsedConditionOptions, useParsedCondition, useSelectElement, useSetKeyword } from "~/lib/api/queries"
import type { Clause, ConditionResponse } from "~/lib/api/types"

import { sameClause } from "./ast"
import type { Patch, WorkspaceState } from "./state"

const NO_CLAUSES: Clause[] = []

/**
 * The parsed condition plus the operations that change it, all of which go through the api. The operations run one at a
 * time, and each starts from the latest `q` (`latest` reads it from the URL), so that two quick operations both stay.
 * An operation writes its result only while the `q` that it started from is still the latest one, so that a response
 * does not undo a change made while it waited, such as clearing the condition.
 */
export const useCondition = (q: string | null, update: (patch: Patch) => void, latest: () => WorkspaceState) => {
  const parsed = useParsedCondition(q)
  const select = useSelectElement()
  const keyword = useSetKeyword()
  const queryClient = useQueryClient()
  const currentQ = useCallback((): string | null => latest().q, [latest])
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  /** Runs the task after the operations before it, whether they succeeded or not. */
  const serial = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task)
    queue.current = run.catch(() => undefined)
    return run
  }, [])
  const ast = parsed.data?.ast ?? null
  const labels = parsed.data?.labels ?? {}
  const selected = parsed.data?.selected ?? NO_CLAUSES
  const keywordText = parsed.data?.keyword ?? ""

  /**
   * Move to a changed condition, with its parse already known from the response that changed it, unless the condition
   * moved on from `startedQ`. Whether the condition was written is returned.
   */
  const apply = useCallback(
    (result: ConditionResponse, startedQ: string | null): boolean => {
      cacheParsedCondition(queryClient, result)
      if (currentQ() !== startedQ) return false
      update({ q: result.dsl })
      return true
    },
    [queryClient, currentQ, update],
  )

  const toggle = useCallback(
    (clauses: Clause[]) =>
      serial(async () => {
        const startedQ = currentQ()
        const result = await select.mutateAsync({ q: startedQ, clauses })
        apply(result, startedQ)
        return result
      }),
    [currentQ, serial, select, apply],
  )

  /** The clauses of the condition that the api names as selected. The AST is fetched for `q`, because the parsed condition of the hook can still be loading after `q` changed. */
  const selectedOf = useCallback(
    async (of: string | null) => (await queryClient.fetchQuery(parsedConditionOptions(of)))?.selected ?? NO_CLAUSES,
    [queryClient],
  )

  /** Take the clauses off the condition. Whether the condition was written is returned. A clause that the condition no longer has stays off; nothing is added. */
  const remove = useCallback(
    (clauses: Clause[]) =>
      serial(async () => {
        const startedQ = currentQ()
        const present = (await selectedOf(startedQ)).filter((s) => clauses.some((clause) => sameClause(s, clause)))
        if (present.length === 0) return false
        return apply(await select.mutateAsync({ q: startedQ, clauses: present }), startedQ)
      }),
    [currentQ, serial, selectedOf, select, apply],
  )

  /** Take every clause of a field off the condition. */
  const removeField = useCallback(
    (field: string) =>
      serial(async () => {
        const startedQ = currentQ()
        const present = (await selectedOf(startedQ)).filter((clause) => clause.field === field)
        if (present.length === 0) return false
        return apply(await select.mutateAsync({ q: startedQ, clauses: present }), startedQ)
      }),
    [currentQ, serial, selectedOf, select, apply],
  )

  /** Replace the clauses of a field with one clause. */
  const replaceField = useCallback(
    (field: string, clause: Clause) =>
      serial(async () => {
        const startedQ = currentQ()
        let current = startedQ
        const present = (await selectedOf(startedQ)).filter((s) => s.field === field)
        if (present.length) {
          current = (await select.mutateAsync({ q: current, clauses: present })).dsl
        }
        return apply(await select.mutateAsync({ q: current, clauses: [clause] }), startedQ)
      }),
    [currentQ, serial, selectedOf, select, apply],
  )

  /** Whether the element's clauses are all selected: the api names the clauses that toggling removes. */
  const isSelected = useCallback(
    (clauses: Clause[]) => clauses.length > 0 && clauses.every((clause) => selected.some((s) => sameClause(s, clause))),
    [selected],
  )

  /**
   * Narrow the condition to what an element counts: its clauses are added by AND to the population. If the condition already has the element's clauses,
   * widen it back to the population instead, so that selecting the element again undoes the selection. The population
   * belongs to the table of the element, which was drawn for `tableQ`, so the operation is dropped when the condition
   * is not `tableQ` when the element is pressed or when the operation starts.
   */
  const toggleNarrow = useCallback(
    (populationQ: string | null, clauses: Clause[], tableQ: string | null) => {
      if (currentQ() !== tableQ) return Promise.resolve()
      const widen = isSelected(clauses)
      return serial(async () => {
        if (currentQ() !== tableQ) return
        if (widen) {
          update({ q: populationQ })
          return
        }
        apply(await select.mutateAsync({ q: populationQ, clauses, mode: "narrow" }), tableQ)
      })
    },
    [currentQ, serial, isSelected, select, apply, update],
  )

  /** Replace the keywords of the condition with the keywords of typed text. Empty text removes them. */
  const setKeyword = useCallback(
    (text: string) =>
      serial(async () => {
        const startedQ = currentQ()
        return apply(await keyword.mutateAsync({ q: startedQ, keyword: text }), startedQ)
      }),
    [currentQ, serial, keyword, apply],
  )

  const clear = useCallback(() => update({ q: null }), [update])

  const applyText = useCallback((text: string) => update({ q: text || null }), [update])

  return {
    ast,
    labels,
    selected,
    keywordText,
    parsing: q !== null && parsed.isPending,
    parseError: parsed.error,
    toggle,
    remove,
    removeField,
    replaceField,
    setKeyword,
    toggleNarrow,
    clear,
    applyText,
    isSelected,
    pending: select.isPending,
  }
}

export type Condition = ReturnType<typeof useCondition>
