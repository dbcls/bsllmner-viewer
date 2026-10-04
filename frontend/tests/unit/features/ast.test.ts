import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { clauseLabel, clausesOfField, conditionGroups, describeAst, keywordLabel, leafToClause, leaves } from "~/features/workspace/ast"
import type { AstNode, Clause } from "~/lib/api/types"

const leaf = (field: string, value: string): AstNode => ({ field, op: "eq", value })
const range = (from: string, to: string): AstNode => ({ field: "date_published", op: "between", from, to })
const keyword = (value: string, isPhrase = false): AstNode => ({ op: "free_text", value, is_phrase: isPhrase })

/** The clauses that the api names as selected for a condition made only of top-level clauses and same-field disjunctions. */
const allClauses = (ast: AstNode | null): Clause[] => leaves(ast).map(leafToClause)

describe("conditionGroups", () => {
  it("makes one row per top-level conjunct and merges same-field ORs", () => {
    const ast: AstNode = {
      op: "AND",
      rules: [{ op: "OR", rules: [leaf("disease", "A"), leaf("disease", "B")] }, leaf("library_strategy", "ATAC-seq"), range("2015-01-01", "2020-12-31")],
    }
    const groups = conditionGroups(ast, allClauses(ast), "")
    expect(groups.map((g) => g.kind)).toEqual(["clauses", "clauses", "clauses"])
    expect(groups[0]).toMatchObject({ field: "disease", clauses: [{ field: "disease", value: "A" }, { field: "disease", value: "B" }] })
    expect(groups[2]).toMatchObject({ clauses: [{ field: "date_published", from: "2015-01-01", to: "2020-12-31" }] })
  })

  it("renders mixed or negated conjuncts as an expression", () => {
    const ast: AstNode = { op: "AND", rules: [{ op: "NOT", rules: [leaf("disease", "A")] }, { op: "OR", rules: [leaf("disease", "A"), leaf("tissue", "T")] }] }
    const groups = conditionGroups(ast, [], "")
    expect(groups[0]).toEqual({ kind: "expression", node: ast.rules[0] })
    expect(groups[1]).toEqual({ kind: "expression", node: ast.rules[1] })
  })

  it("treats a single selected clause as its own group", () => {
    expect(conditionGroups(leaf("tissue", "T"), [{ field: "tissue", value: "T" }], "")).toEqual([
      { kind: "clauses", field: "tissue", clauses: [{ field: "tissue", value: "T" }] },
    ])
    expect(conditionGroups(null, [], "")).toEqual([])
  })

  it("shows a conjunct as an expression unless all its clauses are selected", () => {
    const or: AstNode = { op: "OR", rules: [leaf("disease", "A"), leaf("disease", "B")] }
    expect(conditionGroups(or, [{ field: "disease", value: "A" }], "")).toEqual([{ kind: "expression", node: or }])
    expect(conditionGroups(leaf("disease", "A"), [], "")).toEqual([{ kind: "expression", node: leaf("disease", "A") }])
  })

  it("shows the keyword text of the api in one row before the other rows", () => {
    const ast: AstNode = { op: "AND", rules: [leaf("disease", "A"), keyword("cell line", true), keyword("hypoxia organoid")] }
    expect(conditionGroups(ast, [{ field: "disease", value: "A" }], 'hypoxia organoid "cell line"')).toEqual([
      { kind: "keyword", text: 'hypoxia organoid "cell line"' },
      { kind: "clauses", field: "disease", clauses: [{ field: "disease", value: "A" }] },
    ])
    expect(conditionGroups(keyword("hypoxia"), [], "hypoxia")).toEqual([{ kind: "keyword", text: "hypoxia" }])
  })

  it("leaves a keyword under OR or NOT in an expression row", () => {
    const or: AstNode = { op: "OR", rules: [keyword("hypoxia"), leaf("disease", "A")] }
    expect(conditionGroups(or, [], "")).toEqual([{ kind: "expression", node: or }])
    const not: AstNode = { op: "NOT", rules: [keyword("hypoxia")] }
    expect(conditionGroups({ op: "AND", rules: [leaf("disease", "A"), not] }, [{ field: "disease", value: "A" }], "")[1]).toEqual({ kind: "expression", node: not })
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

  it("does not parenthesize a group nested under the same operator", () => {
    const nestedOr: AstNode = { op: "OR", rules: [leaf("disease", "MONDO:1"), { op: "OR", rules: [leaf("cell_line", "CVCL:1"), keyword("x")] }] }
    expect(describeAst(nestedOr, labels)).toBe("Disease: breast cancer OR Cell line: MCF-7 OR Keyword: x")
    const nestedAnd: AstNode = { op: "AND", rules: [{ op: "AND", rules: [leaf("disease", "MONDO:1"), keyword("x")] }, keyword("y")] }
    expect(describeAst(nestedAnd, labels)).toBe("Disease: breast cancer AND Keyword: x AND Keyword: y")
  })
})

describe("clausesOfField", () => {
  const selected: Clause[] = [{ field: "disease", value: "A" }, { field: "date_published", from: "2015-01-01", to: "2020-12-31" }]
  it("lists the selected clauses of one field", () => {
    expect(clausesOfField(selected, "date_published")).toEqual([{ field: "date_published", from: "2015-01-01", to: "2020-12-31" }])
    expect(clausesOfField(selected, "tissue")).toEqual([])
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

describe("keywordLabel", () => {
  it("escapes a backslash and a double quote of a phrase as they are typed", () => {
    expect(keywordLabel({ op: "free_text", value: "a\\b", is_phrase: true })).toBe('"a\\\\b"')
    expect(keywordLabel({ op: "free_text", value: 'a"b', is_phrase: true })).toBe('"a\\"b"')
    expect(keywordLabel({ op: "free_text", value: "a\\b", is_phrase: false })).toBe("a\\b")
  })

  it("reads back as the value when the escapes are undone", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const label = keywordLabel({ op: "free_text", value, is_phrase: true })
        expect(label.slice(1, -1).replace(/\\(.)/gs, "$1")).toBe(value)
      }),
    )
  })
})
