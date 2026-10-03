import { useClausesCondition } from "./api/queries"
import type { Clause } from "./api/types"
import { workspaceSearch } from "./workspace-state"

/**
 * The workspace URL of the condition of the clauses alone, made by the api, so that an element can be a link before it is
 * pressed. The URL is undefined until the api answers, or while `enabled` is false; `failed` is true when the api could
 * not make it, so that the element can show that it does not lead anywhere.
 */
export const useConditionHref = (clauses: Clause[], enabled = true): { href: string | undefined; failed: boolean } => {
  const condition = useClausesCondition(clauses, enabled)
  return { href: condition.data ? `/entries${workspaceSearch({ q: condition.data.dsl })}` : undefined, failed: condition.isError && !condition.data }
}
