import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import type * as Client from "~/lib/api/client"

import { wrapper } from "../query"

vi.mock("~/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof Client>()
  const { failure } = await import("../query")
  return { ...original, api: { ...original.api, POST: async () => failure(500) } }
})

import { ConditionLink } from "~/features/landing/condition-link"

describe("ConditionLink when the api cannot make the condition", () => {
  it("is drawn as unavailable, so that it does not look like a link that does nothing", async () => {
    render(
      <MemoryRouter>
        <ConditionLink clauses={[{ field: "disease", value: "X:1" }]} className="row">
          label
        </ConditionLink>
      </MemoryRouter>,
      { wrapper },
    )
    await vi.waitFor(() => expect(screen.getByText("label").closest("div")).toHaveAttribute("aria-disabled", "true"))
    expect(screen.queryByRole("link")).toBeNull()
  })
})
