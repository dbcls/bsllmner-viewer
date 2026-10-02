import type { AstNode, Clause } from "~/lib/api/types"
import { fieldLabel, organismLabel, statusLabel } from "~/lib/labels"

export type Leaf = Extract<AstNode, { field: string }>

export const isLeaf = (node: AstNode): node is Leaf => "field" in node

export const isBool = (node: AstNode): node is Extract<AstNode, { rules: AstNode[] }> => "rules" in node

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

/**
 * The clauses a condition names as selected: its top-level clauses and its top-level disjunctions of clauses on one field.
 * Clauses under NOT and clauses in a disjunction over several fields are not selections of their field.
 */
export const selectedClauses = (ast: AstNode | null): Clause[] =>
  conditionGroups(ast).flatMap((group) => (group.kind === "clauses" ? group.clauses : []))

/** Whether every clause of an element is selected in the condition. */
export const hasClauses = (ast: AstNode | null, clauses: Clause[]): boolean => {
  const present = selectedClauses(ast)
  return clauses.length > 0 && clauses.every((c) => present.some((p) => sameClause(p, c)))
}

/** The selected clauses on a field. */
export const clausesOfField = (ast: AstNode | null, field: string): Clause[] => selectedClauses(ast).filter((clause) => clause.field === field)

export type ConditionGroup =
  | { kind: "clauses"; field: string; clauses: Clause[] }
  | { kind: "expression"; node: AstNode }

/** Groups shown by the visual condition: one row per top-level conjunct. */
export const conditionGroups = (ast: AstNode | null): ConditionGroup[] =>
  conjuncts(ast).map((node) => {
    if (isLeaf(node)) return { kind: "clauses", field: node.field, clauses: [leafToClause(node)] }
    if (isBool(node) && node.op === "OR" && node.rules.every(isLeaf)) {
      const rules = node.rules.filter(isLeaf)
      const field = rules[0]?.field
      if (field !== undefined && rules.every((r) => r.field === field)) {
        return { kind: "clauses", field, clauses: rules.map(leafToClause) }
      }
    }
    return { kind: "expression", node }
  })

/** A readable rendering of a part of a condition, with field names and term labels in place of identifiers. */
export const describeAst = (node: AstNode, labels: Record<string, string>, parentOp: string | null = null): string => {
  if (isLeaf(node)) {
    const clause = leafToClause(node)
    return `${groupLabel(clause.field)}: ${clauseLabel(clause, labels)}`
  }
  if (!isBool(node)) return `“${node.value}”`
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
  if (clause.from !== undefined && clause.to !== undefined) {
    const from = clause.from.slice(0, 4)
    const to = clause.to.slice(0, 4)
    return from === to ? from : `${from}–${to}`
  }
  const value = clause.value ?? ""
  if (clause.field.endsWith("_status")) return statusLabel(value)
  if (clause.field.endsWith("_value") || clause.field === "title") return `“${value}”`
  if (clause.field === "organism_id") return organismLabel(value, labels[value])
  return labels[value] ?? value
}

/** Row label of a clause group in the visual condition. */
export const groupLabel = (field: string): string => {
  if (field === "title") return "Title contains"
  if (field === "date_created") return "Created"
  if (field.endsWith("_value")) return `${fieldLabel(field.slice(0, -"_value".length))} contains`
  return fieldLabel(field)
}
