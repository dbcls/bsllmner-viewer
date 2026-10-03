import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { Tabs } from "~/features/workspace/tabs"
import { DEFAULTS } from "~/lib/workspace-state"

/** Whether the page prevented the default of a click: the link does not navigate then. jsdom is kept from navigating either way. */
const clicked = (link: HTMLElement, init: MouseEventInit = {}): boolean => {
  let prevented = false
  const record = (event: Event) => {
    prevented = event.defaultPrevented
    event.preventDefault()
  }
  document.addEventListener("click", record, { once: true })
  fireEvent.click(link, init)
  return prevented
}

const renderTabs = (onTab = vi.fn()) => {
  render(
    <MemoryRouter>
      <Tabs state={{ ...DEFAULTS, q: "a:b" }} onTab={onTab} />
    </MemoryRouter>,
  )
  return onTab
}

describe("Tabs", () => {
  it("writes the tab through onTab on a plain click and does not follow the link", () => {
    const onTab = renderTabs()
    const prevented = clicked(screen.getByRole("link", { name: "Heatmap" }))
    expect(onTab).toHaveBeenCalledExactlyOnceWith("heatmap")
    expect(prevented).toBe(true)
  })

  it("leaves a click with Ctrl to the browser", () => {
    const onTab = renderTabs()
    const prevented = clicked(screen.getByRole("link", { name: "Heatmap" }), { ctrlKey: true })
    expect(onTab).not.toHaveBeenCalled()
    expect(prevented).toBe(false)
  })

  it("keeps the condition and the tab in the href for a new tab", () => {
    renderTabs()
    expect(screen.getByRole("link", { name: "Heatmap" }).getAttribute("href")).toBe("/entries?q=a%3Ab&tab=heatmap")
  })
})
