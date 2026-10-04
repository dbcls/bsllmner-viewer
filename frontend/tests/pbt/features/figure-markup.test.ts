import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { barsSvg } from "~/features/workspace/distribution/bars-svg"
import { matrixSvg } from "~/features/workspace/heatmap/matrix-svg"
import { trendSvg } from "~/features/workspace/trend/trend-svg"

/** Text with the characters that XML treats specially picked often. */
const text = fc.string({
  unit: fc.oneof(fc.constantFrom("&", "<", ">", '"', "'", "\uD800", "￾", "\u{1F600}", " ", "\r"), fc.string({ unit: "binary", minLength: 1, maxLength: 1 })),
  maxLength: 30,
})

/** The text as an XML parser reads it back: without the characters that XML forbids, and with its line breaks normalized. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
const readBack = (value: string) => value.replace(FORBIDDEN, "").replace(/\r\n?/g, "\n")

const texts = (markup: string) => {
  const svg = new DOMParser().parseFromString(markup, "image/svg+xml")
  expect(svg.querySelector("parsererror")).toBeNull()
  return [...svg.querySelectorAll("text")].map((t) => t.textContent)
}

describe("the markup of the saved figures", () => {
  test.prop([text, text, text, text, text, text, text])(
    "is well formed whatever the text of the Heatmap, and keeps the title and the names of the axes as they are",
    (title, meta, row, col, label, id, cell) => {
      const markup = matrixSvg({
        title,
        meta,
        legend: { kind: "count", max: cell },
        corner: { row, col },
        rowLabels: [{ value: "a", label, id, total: 1 }],
        colLabels: [{ value: "b", label, id, total: 1 }],
        cells: [{ row: "a", col: "b", text: cell, background: "#FFFFFF", dark: false, gap: false, soft: false }],
        total: 1,
      })
      const written = texts(markup)
      expect(written).toContain(readBack(title))
      expect(written).toContain(`${readBack(row)} ↓${readBack(col)} →`)
    },
  )

  test.prop([text, text, text, text])("is well formed whatever the text of the Trend, and keeps the title as it is", (title, unit, label, id) => {
    const points = [{ year: 2020, count: 1 }]
    const markup = trendSvg({
      title,
      unit,
      years: [2020],
      max: 1,
      labels: true,
      lines: [{ key: "a", label, id, color: "#123456", width: 2, layer: 0, radius: 4, points }],
    })
    expect(texts(markup)).toContain(readBack(title))
  })

  test.prop([text, text, text, text])("is well formed whatever the text of the Distribution, and keeps the title as it is", (title, unit, label, id) => {
    const markup = barsSvg(title, unit, [{ label, id, count: 1 }], { count: 1, total: 2 })
    expect(texts(markup)).toContain(readBack(title))
  })
})
