import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { cacheParsedCondition, parsedConditionOptions, useParsedCondition, useSelectElement, useSetKeyword } from "~/lib/api/queries"
import type { Clause, ConditionResponse } from "~/lib/api/types"

import { sameClause } from "./ast"
import type { Patch } from "./state"

const NO_CLAUSES: Clause[] = []

/** The parsed condition plus the operations that change it, all of which go through the api. */
export const useCondition = (q: string | null, update: (patch: Patch) => void) => {
  const parsed = useParsedCondition(q)
  const select = useSelectElement()
  const keyword = useSetKeyword()
  const queryClient = useQueryClient()
  const ast = parsed.data?.ast ?? null
  const labels = parsed.data?.labels ?? {}
  const selected = parsed.data?.selected ?? NO_CLAUSES
  const keywordText = parsed.data?.keyword ?? ""

  /** Move to a changed condition, with its parse already known from the response that changed it. */
  const apply = useCallback(
    (result: ConditionResponse) => {
      cacheParsedCondition(queryClient, result)
      update({ q: result.dsl })
    },
    [queryClient, update],
  )

  const toggle = useCallback(
    async (clauses: Clause[]) => {
      const result = await select.mutateAsync({ q, clauses })
      apply(result)
      return result
    },
    [q, select, apply],
  )

  /** Replace the clauses of a field with one clause. The AST is fetched for `q`, because the parsed condition of the hook can still be loading after `q` changed. */
  const replaceField = useCallback(
    async (field: string, clause: Clause) => {
      const parsedQ = await queryClient.fetchQuery(parsedConditionOptions(q))
      const present = (parsedQ?.selected ?? []).filter((clause) => clause.field === field)
      let current = q
      if (present.length) {
        current = (await select.mutateAsync({ q: current, clauses: present })).dsl
      }
      apply(await select.mutateAsync({ q: current, clauses: [clause] }))
    },
    [q, queryClient, select, apply],
  )

  /** Whether the element's clauses are all selected: the api names the clauses that toggling removes. */
  const isSelected = useCallback(
    (clauses: Clause[]) => clauses.length > 0 && clauses.every((clause) => selected.some((s) => sameClause(s, clause))),
    [selected],
  )

  /**
   * Narrow the condition to what an element counts: its clauses are added by AND to the population. If the condition already has the element's clauses,
   * widen it back to the population instead, so that selecting the element again undoes the selection.
   */
  const toggleNarrow = useCallback(
    async (populationQ: string | null, clauses: Clause[]) => {
      if (isSelected(clauses)) {
        update({ q: populationQ })
        return
      }
      apply(await select.mutateAsync({ q: populationQ, clauses, mode: "narrow" }))
    },
    [isSelected, select, apply, update],
  )

  /** Replace the keywords of the condition with the keywords of typed text. Empty text removes them. */
  const setKeyword = useCallback(
    async (text: string) => {
      apply(await keyword.mutateAsync({ q, keyword: text }))
    },
    [q, keyword, apply],
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
