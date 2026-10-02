import { describe, expect, it } from "vitest"

import { clauseLabel, clausesOfField, conditionGroups, describeAst, hasClauses, selectedClauses } from "~/features/workspace/ast"
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
    expect(groups[0]).toEqual({ kind: "expression", node: ast.rules[0] })
    expect(groups[1]).toEqual({ kind: "expression", node: ast.rules[1] })
  })

  it("treats a single clause as its own group", () => {
    expect(conditionGroups(leaf("title", "tumor"))).toEqual([{ kind: "clauses", field: "title", clauses: [{ field: "title", value: "tumor" }] }])
    expect(conditionGroups(null)).toEqual([])
  })
})

describe("describeAst", () => {
  const labels = { "MONDO:1": "breast cancer", "CVCL:1": "MCF-7" }

  it("names fields and terms by their labels", () => {
    expect(describeAst(leaf("disease", "MONDO:1"), labels)).toBe("Disease: breast cancer")
    expect(describeAst(leaf("disease", "MONDO:9"), labels)).toBe("Disease: MONDO:9")
    expect(describeAst(range("2015-01-01", "2020-12-31"), labels)).toBe("Created: 2015–2020")
  })

  it("keeps NOT and joins the rules of a disjunction over several fields", () => {
    expect(describeAst({ op: "NOT", rules: [leaf("library_strategy", "RNA-Seq")] }, labels)).toBe("NOT Assay: RNA-Seq")
    expect(describeAst({ op: "OR", rules: [leaf("cell_line", "CVCL:1"), leaf("title", "tumor")] }, labels)).toBe(
      "Cell line: MCF-7 OR Title contains: “tumor”",
    )
  })

  it("parenthesizes a group nested under another operator", () => {
    const nested: AstNode = { op: "NOT", rules: [{ op: "OR", rules: [leaf("disease", "MONDO:1"), leaf("cell_line", "CVCL:1")] }] }
    expect(describeAst(nested, labels)).toBe("NOT (Disease: breast cancer OR Cell line: MCF-7)")
    const mixed: AstNode = { op: "OR", rules: [{ op: "AND", rules: [leaf("disease", "MONDO:1"), leaf("title", "x")] }, leaf("title", "y")] }
    expect(describeAst(mixed, labels)).toBe("(Disease: breast cancer AND Title contains: “x”) OR Title contains: “y”")
  })

  it("renders a NOT without a rule and a term without a field", () => {
    expect(describeAst({ op: "NOT", rules: [] }, labels)).toBe("NOT")
    expect(describeAst({ op: "free_text", value: "tumor" }, labels)).toBe("“tumor”")
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

describe("selectedClauses", () => {
  it("lists top-level clauses and same-field disjunctions", () => {
    const ast: AstNode = { op: "AND", rules: [{ op: "OR", rules: [leaf("disease", "A"), leaf("disease", "B")] }, leaf("library_strategy", "ATAC-seq")] }
    expect(selectedClauses(ast)).toEqual([
      { field: "disease", value: "A" },
      { field: "disease", value: "B" },
      { field: "library_strategy", value: "ATAC-seq" },
    ])
    expect(selectedClauses(null)).toEqual([])
  })

  it("does not treat a negated clause as selected", () => {
    const ast: AstNode = { op: "AND", rules: [leaf("disease", "A"), { op: "NOT", rules: [leaf("library_strategy", "RNA-Seq")] }] }
    expect(hasClauses(ast, [{ field: "library_strategy", value: "RNA-Seq" }])).toBe(false)
    expect(clausesOfField(ast, "library_strategy")).toEqual([])
    expect(hasClauses(ast, [{ field: "disease", value: "A" }])).toBe(true)
  })

  it("does not treat the clauses of a disjunction over several fields as selected", () => {
    const ast: AstNode = { op: "OR", rules: [leaf("cell_line", "A"), leaf("tissue", "T")] }
    expect(selectedClauses(ast)).toEqual([])
    expect(clausesOfField(ast, "cell_line")).toEqual([])
    expect(hasClauses(ast, [{ field: "tissue", value: "T" }])).toBe(false)
  })

  it("does not treat a clause nested under a conjunction inside a disjunction as selected", () => {
    const ast: AstNode = { op: "OR", rules: [{ op: "AND", rules: [leaf("disease", "A"), leaf("title", "x")] }, leaf("disease", "B")] }
    expect(clausesOfField(ast, "disease")).toEqual([])
  })
})
