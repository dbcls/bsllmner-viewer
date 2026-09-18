import { describe, expect, it } from "vitest"

import { clauseLabel, clausesOfField, conditionGroups, formatAst, hasClauses } from "~/features/workspace/ast"
import type { AstNode } from "~/lib/api/types"

const leaf = (field: string, value: string): AstNode => ({ field, op: "eq", value })
const range = (from: string, to: string): AstNode => ({ field: "date_created", op: "between", from, to })

describe("conditionGroups", () => {
  it("makes one row per top-level conjunct and merges same-field ORs", () => {
    const ast: AstNode = {
      op: "AND",
      rules: [{ op: "OR", rules: [leaf("disease", "A"), leaf("disease", "B")] }, leaf("library_strategy", "ATAC-seq"), range("2015-01-01", "2020-12-31")],
    }
    const groups = conditionGroups(ast)
    expect(groups.map((g) => g.kind)).toEqual(["clauses", "clauses", "clauses"])
    expect(groups[0]).toMatchObject({ field: "disease", clauses: [{ field: "disease", value: "A" }, { field: "disease", value: "B" }] })
    expect(groups[2]).toMatchObject({ clauses: [{ field: "date_created", from: "2015-01-01", to: "2020-12-31" }] })
  })

  it("renders mixed or negated conjuncts as an expression", () => {
    const ast: AstNode = { op: "AND", rules: [{ op: "NOT", rules: [leaf("disease", "A")] }, { op: "OR", rules: [leaf("disease", "A"), leaf("tissue", "T")] }] }
    const groups = conditionGroups(ast)
    expect(groups[0]).toEqual({ kind: "expression", text: "NOT disease:A", node: ast.rules[0] })
    expect(groups[1]).toMatchObject({ kind: "expression", text: "disease:A OR tissue:T" })
  })

  it("treats a single clause as its own group", () => {
    expect(conditionGroups(leaf("title", "tumor"))).toEqual([{ kind: "clauses", field: "title", clauses: [{ field: "title", value: "tumor" }] }])
    expect(conditionGroups(null)).toEqual([])
  })
})

describe("formatAst", () => {
  it("quotes values that are not bare words and parenthesizes OR under AND", () => {
    const ast: AstNode = { op: "AND", rules: [{ op: "OR", rules: [leaf("disease", "MONDO:1"), leaf("disease", "MONDO:2")] }, leaf("title", "a b")] }
    expect(formatAst(ast)).toBe('(disease:"MONDO:1" OR disease:"MONDO:2") AND title:"a b"')
  })
})

describe("hasClauses and clausesOfField", () => {
  const ast: AstNode = { op: "AND", rules: [leaf("disease", "A"), range("2015-01-01", "2020-12-31")] }
  it("finds present clauses regardless of value kind", () => {
    expect(hasClauses(ast, [{ field: "disease", value: "A" }])).toBe(true)
    expect(hasClauses(ast, [{ field: "disease", value: "A" }, { field: "disease", value: "B" }])).toBe(false)
    expect(hasClauses(ast, [{ field: "date_created", from: "2015-01-01", to: "2020-12-31" }])).toBe(true)
    expect(hasClauses(null, [{ field: "disease", value: "A" }])).toBe(false)
  })
  it("lists the clauses of one field", () => {
    expect(clausesOfField(ast, "date_created")).toEqual([{ field: "date_created", from: "2015-01-01", to: "2020-12-31" }])
    expect(clausesOfField(ast, "tissue")).toEqual([])
  })
})

describe("clauseLabel", () => {
  it("uses labels, status names, quotes, and year ranges", () => {
    expect(clauseLabel({ field: "disease", value: "MONDO:1" }, { "MONDO:1": "breast cancer" })).toBe("breast cancer")
    expect(clauseLabel({ field: "disease", value: "MONDO:9" }, {})).toBe("MONDO:9")
    expect(clauseLabel({ field: "disease_status", value: "no_value" }, {})).toBe("No value")
    expect(clauseLabel({ field: "disease_value", value: "breast" }, {})).toBe("“breast”")
    expect(clauseLabel({ field: "organism_id", value: "9606" }, {})).toBe("Human")
    expect(clauseLabel({ field: "date_created", from: "2015-01-01", to: "2020-12-31" }, {})).toBe("2015–2020")
    expect(clauseLabel({ field: "date_created", from: "2020-01-01", to: "2020-12-31" }, {})).toBe("2020")
  })
})
