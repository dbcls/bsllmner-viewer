import type { AstNode, Clause } from "~/lib/api/types"
import { rangeLabel } from "~/lib/date-range"
import { fieldLabel, fieldOfStatusField, organismLabel, statusLabel } from "~/lib/labels"

export type Leaf = Extract<AstNode, { field: string }>

export const isLeaf = (node: AstNode): node is Leaf => "field" in node

export const isBool = (node: AstNode): node is Extract<AstNode, { rules: AstNode[] }> => "rules" in node

export type Keyword = Extract<AstNode, { op: "free_text" }>

export const isKeyword = (node: AstNode): node is Keyword => node.op === "free_text"

/** A keyword as it is typed: a phrase in double quotes, words as they are. */
export const keywordLabel = (node: Keyword): string => (node.is_phrase ? `"${node.value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : node.value)

/** Top-level conjuncts of a condition. */
export const conjuncts = (ast: AstNode | null): AstNode[] => {
  if (!ast) return []
  if (isBool(ast) && ast.op === "AND") return ast.rules
  return [ast]
}

export const leaves = (node: AstNode | null): Leaf[] => {
  if (!node) return []
  if (isLeaf(node)) return [node]
  if (isBool(node)) return node.rules.flatMap(leaves)
  return []
}

export const leafToClause = (leaf: Leaf): Clause =>
  leaf.op === "between" ? { field: leaf.field, from: leaf.from, to: leaf.to } : { field: leaf.field, value: leaf.value }

export const sameClause = (a: Clause, b: Clause): boolean =>
  a.field === b.field && a.value === b.value && a.from === b.from && a.to === b.to

/** The clauses of a field among the selected clauses. */
export const clausesOfField = (selected: Clause[], field: string): Clause[] => selected.filter((clause) => clause.field === field)

export type ConditionGroup =
  | { kind: "keyword"; text: string }
  | { kind: "clauses"; field: string; clauses: Clause[] }
  | { kind: "expression"; node: AstNode }

/**
 * Rows shown by the visual condition: the keywords in one row first, then one row per other top-level conjunct. A
 * conjunct is a row of chips only when its clauses are all selected, because a chip removes its clause by toggling it.
 */
export const conditionGroups = (ast: AstNode | null, selected: Clause[], keyword: string): ConditionGroup[] => {
  const keywordRow: ConditionGroup[] = keyword ? [{ kind: "keyword", text: keyword }] : []
  return [...keywordRow, ...conjuncts(ast).filter((node) => !isKeyword(node)).map((node) => nonKeywordGroup(node, selected))]
}

/** A top-level clause or a disjunction of clauses on one field, when all of them are selected, or any other expression. */
const nonKeywordGroup = (node: AstNode, selected: Clause[]): ConditionGroup => {
  const expression: ConditionGroup = { kind: "expression", node }
  const clauses = isLeaf(node) ? [leafToClause(node)] : sameFieldDisjunction(node)
  const field = clauses?.[0]?.field
  if (clauses === null || field === undefined) return expression
  return clauses.every((clause) => selected.some((s) => sameClause(s, clause))) ? { kind: "clauses", field, clauses } : expression
}

/** The clauses of a disjunction of clauses on one field, or null for any other node. */
const sameFieldDisjunction = (node: AstNode): Clause[] | null => {
  if (!isBool(node) || node.op !== "OR" || !node.rules.every(isLeaf)) return null
  const clauses = node.rules.filter(isLeaf).map(leafToClause)
  const field = clauses[0]?.field
  return clauses.every((clause) => clause.field === field) ? clauses : null
}

/** A readable rendering of a part of a condition, with field names and term labels in place of identifiers. */
export const describeAst = (node: AstNode, labels: Record<string, string>, parentOp: string | null = null): string => {
  if (isLeaf(node)) {
    const clause = leafToClause(node)
    return `${groupLabel(clause.field)}: ${clauseLabel(clause, labels)}`
  }
  if (isKeyword(node)) return `Keyword: ${keywordLabel(node)}`
  if (!isBool(node)) return ""
  if (node.op === "NOT") {
    const child = node.rules[0]
    if (!child) return "NOT"
    return isBool(child) ? `NOT (${describeAst(child, labels)})` : `NOT ${describeAst(child, labels)}`
  }
  const text = node.rules.map((rule) => describeAst(rule, labels, node.op)).join(` ${node.op} `)
  return parentOp !== null && parentOp !== node.op ? `(${text})` : text
}

/** Short display label of a clause value. */
export const clauseLabel = (clause: Clause, labels: Record<string, string>): string => {
  if (clause.from !== undefined && clause.to !== undefined) return rangeLabel({ from: clause.from, to: clause.to })
  const value = clause.value ?? ""
  if (fieldOfStatusField(clause.field) !== null) return statusLabel(value)
  if (clause.field === "organism_id") return organismLabel(value, labels[value])
  return labels[value] ?? value
}

/** Row label of a clause group in the visual condition. */
export const groupLabel = (field: string): string => {
  if (field === "date_published") return "Publication date"
  return fieldLabel(field)
}
