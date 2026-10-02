import type { AstNode } from "./api/types"
import { organismLabel } from "./labels"

/**
 * The values of a condition, one short text per clause, in the order they are written: the label of a term, the name of
 * an organism, the text of a "contains" clause in quotes, and the years of a range. A clause under an odd number of NOTs
 * starts with "not". `labels` maps a term ID or an organism ID to its name, as the parse API returns it.
 */
export const conditionLabels = (ast: AstNode | null, labels: Record<string, string>): string[] => {
  const walk = (node: AstNode, negated: boolean): string[] => {
    if ("rules" in node) return node.rules.flatMap((rule) => walk(rule, node.op === "NOT" ? !negated : negated))
    const text = leafText(node, labels)
    return [negated ? `not ${text}` : text]
  }
  return ast ? walk(ast, false) : []
}

const leafText = (node: Exclude<AstNode, { rules: AstNode[] }>, labels: Record<string, string>): string => {
  if (node.op === "free_text") return node.value
  if (node.op === "between") return `${node.from} to ${node.to}`
  if (node.op === "contains") return `“${node.value}”`
  if (node.field === "organism_id") return organismLabel(node.value, labels[node.value])
  return labels[node.value] ?? node.value
}
