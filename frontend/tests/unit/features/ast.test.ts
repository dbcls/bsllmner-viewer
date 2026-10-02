import { describe, expect, it } from "vitest"

import { clauseLabel, clausesOfField, conditionGroups, describeAst, hasClauses, keywordText, selectedClauses } from "~/features/workspace/ast"
import type { AstNode } from "~/lib/api/types"

const leaf = (field: string, value: string): AstNode => ({ field, op: "eq", value })
const range = (from: string, to: string): AstNode => ({ field: "date_published", op: "between", from, to })
const keyword = (value: string, isPhrase = false): AstNode => ({ op: "free_text", value, is_phrase: isPhrase })

describe("conditionGroups", () => {
  it("makes one row per top-level conjunct and merges same-field ORs", () => {
    const ast: AstNode = {
      op: "AND",
      rules: [{ op: "OR", rules: [leaf("disease", "A"), leaf("disease", "B")] }, leaf("library_strategy", "ATAC-seq"), range("2015-01-01", "2020-12-31")],
    }
    const groups = conditionGroups(ast)
    expect(groups.map((g) => g.kind)).toEqual(["clauses", "clauses", "clauses"])
    expect(groups[0]).toMatchObject({ field: "disease", clauses: [{ field: "disease", value: "A" }, { field: "disease", value: "B" }] })
    expect(groups[2]).toMatchObject({ clauses: [{ field: "date_published", from: "2015-01-01", to: "2020-12-31" }] })
  })

  it("renders mixed or negated conjuncts as an expression", () => {
    const ast: AstNode = { op: "AND", rules: [{ op: "NOT", rules: [leaf("disease", "A")] }, { op: "OR", rules: [leaf("disease", "A"), leaf("tissue", "T")] }] }
    const groups = conditionGroups(ast)
    expect(groups[0]).toEqual({ kind: "expression", node: ast.rules[0] })
    expect(groups[1]).toEqual({ kind: "expression", node: ast.rules[1] })
  })

  it("treats a single clause as its own group", () => {
    expect(conditionGroups(leaf("tissue", "T"))).toEqual([{ kind: "clauses", field: "tissue", clauses: [{ field: "tissue", value: "T" }] }])
    expect(conditionGroups(null)).toEqual([])
  })

  it("shows the top-level keywords in one row before the other rows", () => {
    const ast: AstNode = { op: "AND", rules: [leaf("disease", "A"), keyword("cell line", true), keyword("hypoxia organoid")] }
    expect(conditionGroups(ast)).toEqual([
      { kind: "keyword", text: 'hypoxia organoid "cell line"' },
      { kind: "clauses", field: "disease", clauses: [{ field: "disease", value: "A" }] },
    ])
    expect(conditionGroups(keyword("hypoxia"))).toEqual([{ kind: "keyword", text: "hypoxia" }])
  })

  it("leaves a keyword under OR or NOT in an expression row", () => {
    const or: AstNode = { op: "OR", rules: [keyword("hypoxia"), leaf("disease", "A")] }
    expect(conditionGroups(or)).toEqual([{ kind: "expression", node: or }])
    const not: AstNode = { op: "NOT", rules: [keyword("hypoxia")] }
    expect(conditionGroups({ op: "AND", rules: [leaf("disease", "A"), not] })[1]).toEqual({ kind: "expression", node: not })
  })

  it("does not count keywords as selected clauses", () => {
    expect(selectedClauses({ op: "AND", rules: [keyword("hypoxia"), leaf("disease", "A")] })).toEqual([{ field: "disease", value: "A" }])
  })
})

describe("keywordText", () => {
  it("writes the top-level keywords as typed, words first and then phrases in quotes", () => {
    expect(keywordText({ op: "AND", rules: [keyword("breast cancer", true), keyword("organoid"), leaf("disease", "A")] })).toBe(
      'organoid "breast cancer"',
    )
    expect(keywordText(keyword('say "hi"', true))).toBe('"say \\"hi\\""')
  })

  it("is empty without top-level keywords", () => {
    expect(keywordText(null)).toBe("")
    expect(keywordText(leaf("disease", "A"))).toBe("")
    expect(keywordText({ op: "OR", rules: [keyword("hypoxia"), leaf("disease", "A")] })).toBe("")
  })
})

describe("describeAst", () => {
  const labels = { "MONDO:1": "breast cancer", "CVCL:1": "MCF-7" }

  it("names fields and terms by their labels", () => {
    expect(describeAst(leaf("disease", "MONDO:1"), labels)).toBe("Disease: breast cancer")
    expect(describeAst(leaf("disease", "MONDO:9"), labels)).toBe("Disease: MONDO:9")
    expect(describeAst(range("2015-01-01", "2020-12-31"), labels)).toBe("Publication date: 2015–2020")
  })

  it("keeps NOT and joins the rules of a disjunction over several fields", () => {
    expect(describeAst({ op: "NOT", rules: [leaf("library_strategy", "RNA-Seq")] }, labels)).toBe("NOT Assay: RNA-Seq")
    expect(describeAst({ op: "OR", rules: [leaf("cell_line", "CVCL:1"), keyword("tumor")] }, labels)).toBe("Cell line: MCF-7 OR Keyword: tumor")
  })

  it("parenthesizes a group nested under another operator", () => {
    const nested: AstNode = { op: "NOT", rules: [{ op: "OR", rules: [leaf("disease", "MONDO:1"), leaf("cell_line", "CVCL:1")] }] }
    expect(describeAst(nested, labels)).toBe("NOT (Disease: breast cancer OR Cell line: MCF-7)")
    const mixed: AstNode = { op: "OR", rules: [{ op: "AND", rules: [leaf("disease", "MONDO:1"), keyword("x")] }, keyword("y z", true)] }
    expect(describeAst(mixed, labels)).toBe('(Disease: breast cancer AND Keyword: x) OR Keyword: "y z"')
  })

  it("renders a NOT without a rule and a keyword", () => {
    expect(describeAst({ op: "NOT", rules: [] }, labels)).toBe("NOT")
    expect(describeAst(keyword("tumor"), labels)).toBe("Keyword: tumor")
  })
})

describe("hasClauses and clausesOfField", () => {
  const ast: AstNode = { op: "AND", rules: [leaf("disease", "A"), range("2015-01-01", "2020-12-31")] }
  it("finds present clauses regardless of value kind", () => {
    expect(hasClauses(ast, [{ field: "disease", value: "A" }])).toBe(true)
    expect(hasClauses(ast, [{ field: "disease", value: "A" }, { field: "disease", value: "B" }])).toBe(false)
    expect(hasClauses(ast, [{ field: "date_published", from: "2015-01-01", to: "2020-12-31" }])).toBe(true)
    expect(hasClauses(null, [{ field: "disease", value: "A" }])).toBe(false)
  })
  it("lists the clauses of one field", () => {
    expect(clausesOfField(ast, "date_published")).toEqual([{ field: "date_published", from: "2015-01-01", to: "2020-12-31" }])
    expect(clausesOfField(ast, "tissue")).toEqual([])
  })
})

describe("clauseLabel", () => {
  it("uses labels, status names, organism names, and year ranges", () => {
    expect(clauseLabel({ field: "disease", value: "MONDO:1" }, { "MONDO:1": "breast cancer" })).toBe("breast cancer")
    expect(clauseLabel({ field: "disease", value: "MONDO:9" }, {})).toBe("MONDO:9")
    expect(clauseLabel({ field: "disease_status", value: "no_value" }, {})).toBe("No value")
    expect(clauseLabel({ field: "organism_id", value: "9606" }, { "9606": "Homo sapiens" })).toBe("Homo sapiens")
    expect(clauseLabel({ field: "organism_id", value: "9606" }, {})).toBe("9606")
    expect(clauseLabel({ field: "date_published", from: "2015-01-01", to: "2020-12-31" }, {})).toBe("2015–2020")
    expect(clauseLabel({ field: "date_published", from: "2020-01-01", to: "2020-12-31" }, {})).toBe("2020")
    expect(clauseLabel({ field: "date_published", from: "2021-10-02", to: "2026-10-02" }, {})).toBe("2021-10-02 – 2026-10-02")
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
