import { useClausesCondition } from "./api/queries"
import type { Clause } from "./api/types"
import { workspaceSearch } from "./workspace-state"

/**
 * The workspace URL of the condition of the clauses alone, made by the api, so that an element can be a link before it is
 * pressed. Undefined until the api answers, or while `enabled` is false.
 */
export const useConditionHref = (clauses: Clause[], enabled = true): string | undefined => {
  const condition = useClausesCondition(clauses, enabled)
  return condition.data ? `/entries${workspaceSearch({ q: condition.data.dsl })}` : undefined
}
