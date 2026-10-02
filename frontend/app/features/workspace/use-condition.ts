import { useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { parsedConditionOptions, useParsedCondition, useSelectElement } from "~/lib/api/queries"
import type { AstNode, Clause } from "~/lib/api/types"

import { clausesOfField, hasClauses } from "./ast"
import type { Patch } from "./state"

/** The parsed condition plus the operations that change it, all of which go through the api. */
export const useCondition = (q: string | null, update: (patch: Patch) => void) => {
  const parsed = useParsedCondition(q)
  const select = useSelectElement()
  const queryClient = useQueryClient()
  const ast = (parsed.data?.ast ?? null) as AstNode | null
  const labels = parsed.data?.labels ?? {}

  const toggle = useCallback(
    async (clauses: Clause[]) => {
      const result = await select.mutateAsync({ q, clauses })
      update({ q: result.dsl })
      return result
    },
    [q, select, update],
  )

  /** Replace the clauses of a field with one clause. The AST is fetched for `q`, because the parsed condition of the hook can still be loading after `q` changed. */
  const replaceField = useCallback(
    async (field: string, clause: Clause) => {
      const parsedQ = await queryClient.fetchQuery(parsedConditionOptions(q))
      const present = clausesOfField((parsedQ?.ast ?? null) as AstNode | null, field)
      let current = q
      if (present.length) {
        current = (await select.mutateAsync({ q: current, clauses: present })).dsl
      }
      const result = await select.mutateAsync({ q: current, clauses: [clause] })
      update({ q: result.dsl })
    },
    [q, queryClient, select, update],
  )

  /** The condition that matches what an element counts: the element's clauses added by AND to its population. */
  const narrowed = useCallback(
    async (populationQ: string | null, clauses: Clause[]) => (await select.mutateAsync({ q: populationQ, clauses, mode: "narrow" })).dsl,
    [select],
  )

  const clear = useCallback(() => update({ q: null }), [update])

  const applyText = useCallback((text: string) => update({ q: text || null }), [update])

  const isSelected = useCallback((clauses: Clause[]) => hasClauses(ast, clauses), [ast])

  return { ast, labels, parseError: parsed.error, toggle, replaceField, narrowed, clear, applyText, isSelected, pending: select.isPending }
}

export type Condition = ReturnType<typeof useCondition>
