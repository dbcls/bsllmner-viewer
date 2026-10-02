import { useCallback } from "react"

import { useParsedCondition, useSelectElement } from "~/lib/api/queries"
import type { AstNode, Clause } from "~/lib/api/types"

import { clausesOfField, hasClauses } from "./ast"
import type { Patch } from "./state"

/** The parsed condition plus the operations that change it, all of which go through the api. */
export const useCondition = (q: string | null, update: (patch: Patch) => void) => {
  const parsed = useParsedCondition(q)
  const select = useSelectElement()
  const ast = (parsed.data?.ast ?? null) as AstNode | null
  const labels = parsed.data?.labels ?? {}

  const toggle = useCallback(
    async (clauses: Clause[]) => {
      const result = await select.mutateAsync({ q, clauses })
      update({ q: result.q })
      return result
    },
    [q, select, update],
  )

  const replaceField = useCallback(
    async (field: string, clause: Clause) => {
      const present = clausesOfField(ast, field)
      let current = q
      if (present.length) {
        current = (await select.mutateAsync({ q: current, clauses: present })).q
      }
      const result = await select.mutateAsync({ q: current, clauses: [clause] })
      update({ q: result.q })
    },
    [ast, q, select, update],
  )

  /** The condition that matches the records an element counts: the element's clauses added by AND to its population. */
  const narrowed = useCallback(
    async (populationQ: string | null, clauses: Clause[]) => (await select.mutateAsync({ q: populationQ, clauses, mode: "narrow" })).q,
    [select],
  )

  const clear = useCallback(() => update({ q: null }), [update])

  const applyText = useCallback((text: string) => update({ q: text || null }), [update])

  const isSelected = useCallback((clauses: Clause[]) => hasClauses(ast, clauses), [ast])

  return { ast, labels, parseError: parsed.error, toggle, replaceField, narrowed, clear, applyText, isSelected, pending: select.isPending }
}

export type Condition = ReturnType<typeof useCondition>
