import { screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { renderWithQuery } from "../query"

type Clause = { field: string; value: string }

const state = vi.hoisted(() => ({ calls: 0, release: undefined as (() => void) | undefined }))

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { ok } = await import("../query")
  const POST = async (_path: string, init: { body: { clauses: Clause[] } }) => {
    state.calls += 1
    const [clause] = init.body.clauses
    // The condition of "slow" answers only when the test releases it, as a slow network would.
    if (clause?.value === "slow") {
      await new Promise<void>((resolve) => {
        state.release = resolve
      })
    }
    const data = { dsl: `${clause?.field}:${clause?.value}`, ast: {}, labels: {} }
    return ok(data)
  }
  return { ...original, api: { ...original.api, POST } }
})

import { ConditionLink } from "~/features/landing/condition-link"

const renderLinks = (clauses: Clause[][]) => {
  renderWithQuery(
    <MemoryRouter>
      {clauses.map((element, index) => (
        <ConditionLink key={index} clauses={element} className="row">
          {`element ${index}`}
        </ConditionLink>
      ))}
    </MemoryRouter>,
  )
}

describe("ConditionLink", () => {
  it("links to the workspace with the condition that the api gives, and asks once for elements with the same clauses", async () => {
    state.calls = 0
    renderLinks([[{ field: "library_strategy", value: "RNA-Seq" }], [{ field: "library_strategy", value: "RNA-Seq" }]])
    const [first, second] = await screen.findAllByRole("link")
    expect(first?.getAttribute("href")).toBe("/entries?q=library_strategy%3ARNA-Seq")
    expect(second?.getAttribute("href")).toBe("/entries?q=library_strategy%3ARNA-Seq")
    expect(state.calls).toBe(1)
  })

  it("draws the element with the same classes and no link until the api answers", async () => {
    renderLinks([[{ field: "library_strategy", value: "slow" }]])
    const element = screen.getByText("element 0")
    expect(element.tagName).toBe("DIV")
    expect(element.className).toBe("row")
    expect(screen.queryByRole("link")).toBeNull()
    state.release?.()
    const link = await screen.findByRole("link")
    expect(link.className).toBe("row")
  })
})
