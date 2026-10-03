import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StatusMeanings } from "~/ui/status-meanings"

const STATUSES = [
  { code: "a", label: "Alpha", meaning: "The first.", mark: "filled", tone: "brand" },
  { code: "b", label: "Beta", meaning: "The second.", mark: "empty", tone: "warn" },
] as const

describe("StatusMeanings", () => {
  it("lists each status with its name and meaning, then each closing sentence on its own line", () => {
    const { container } = render(
      <StatusMeanings statuses={STATUSES}>
        {"One."}
        {"Two."}
      </StatusMeanings>,
    )
    const lines = [...container.children].map((line) => line.textContent)
    expect(lines).toEqual(["Alpha The first.", "Beta The second.", "One.", "Two."])
    expect(container.children[0]).not.toHaveClass("mt-1.5")
    expect(container.children[1]).toHaveClass("mt-1.5")
    expect(container.children[2]).toHaveClass("mt-1.5")
  })

  it("lists only the statuses when there is no closing sentence", () => {
    const { container } = render(<StatusMeanings statuses={STATUSES} />)
    expect(container.children).toHaveLength(2)
  })
})
