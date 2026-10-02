import { fc, test } from "@fast-check/vitest"
import { describe, expect, it } from "vitest"

import type { AstNode } from "~/lib/api/types"
import { conditionLabels } from "~/lib/condition-labels"

type Leaf = { field: string; op: "eq"; value: string }

const termId = fc.stringMatching(/^[A-Z]{2,5}:[0-9]{3,7}$/)
const name = fc.stringMatching(/^[a-z][a-z ]{0,15}[a-z]$/)
const leaf: fc.Arbitrary<{ node: Leaf; label: string }> = fc.tuple(termId, name).map(([value, label]) => ({
  node: { field: "disease", op: "eq", value },
  label,
}))

describe("conditionLabels", () => {
  it("returns nothing for no condition", () => {
    expect(conditionLabels(null, {})).toEqual([])
  })

  it("names each kind of clause in the order of the condition", () => {
    const ast: AstNode = {
      op: "AND",
      rules: [
        { field: "disease", op: "eq", value: "MONDO:0007254" },
        { field: "library_strategy", op: "eq", value: "ATAC-seq" },
        { field: "organism_id", op: "eq", value: "9606" },
        { field: "organism_id", op: "eq", value: "7955" },
        { op: "free_text", value: "liver" },
        { field: "date_created", op: "between", from: "2018", to: "2022" },
        { op: "NOT", rules: [{ field: "tissue", op: "eq", value: "UBERON:0002107" }] },
      ],
    }
    const labels = { "MONDO:0007254": "breast cancer", "9606": "Homo sapiens", "7955": "Danio rerio", "UBERON:0002107": "liver" }
    expect(conditionLabels(ast, labels)).toEqual(["breast cancer", "ATAC-seq", "Human", "Danio rerio", "“liver”", "2018 to 2022", "not liver"])
  })

  test.prop([fc.array(leaf, { minLength: 1, maxLength: 6 }), fc.nat({ max: 4 })])(
    "gives one text per clause, its label, with not only under an odd number of NOTs",
    (leaves, nots) => {
      const labels = Object.fromEntries(leaves.map(({ node, label }) => [node.value, label]))
      let ast: AstNode = { op: "AND", rules: leaves.map(({ node }) => node) }
      for (let i = 0; i < nots; i += 1) ast = { op: "NOT", rules: [ast] }
      const expected = leaves.map(({ node }) => labels[node.value] ?? node.value)
      expect(conditionLabels(ast, labels)).toEqual(nots % 2 === 1 ? expected.map((text) => `not ${text}`) : expected)
    },
  )

  test.prop([fc.array(termId, { minLength: 1, maxLength: 6 })])("falls back to the value when the API gives no label", (values) => {
    const ast: AstNode = { op: "OR", rules: values.map((value): AstNode => ({ field: "cell_line", op: "eq", value })) }
    expect(conditionLabels(ast, {})).toEqual(values)
  })
})
