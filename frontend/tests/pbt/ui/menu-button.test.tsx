import { fc, test } from "@fast-check/vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect } from "vitest"

import { MenuButton, type MenuButtonGroup, type MenuButtonItem } from "~/ui/menu-button"

type Key = "{ArrowDown}" | "{ArrowUp}" | "{Home}" | "{End}"

/** Groups of 1 to 4 items, each item a link or an action, with unique labels. */
const layout = fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 1, max: 4 }), fc.array(fc.boolean(), { minLength: 4, maxLength: 4 })), {
  minLength: 1,
  maxLength: 4,
})
const keys = fc.array(fc.constantFrom<Key>("{ArrowDown}", "{ArrowUp}", "{Home}", "{End}"), { maxLength: 12 })

const build = (shape: [boolean, number, boolean[]][]) => {
  let count = 0
  const entries = shape.map(([grouped, size, links], position) => {
    const items: MenuButtonItem[] = links.slice(0, size).map((link) => {
      const label = `Item${count++}`
      return link ? { label, href: `/${label}` } : { label, onSelect: () => undefined }
    })
    return grouped ? ({ title: `Group${position}`, note: "note", items } satisfies MenuButtonGroup) : items
  })
  return { entries: entries.flat(), count }
}

describe("MenuButton keyboard", () => {
  test.prop([layout, keys], { numRuns: 40 })(
    "reaches the items in order with the arrow keys, Home, and End, wrapping, whatever mix of links, actions, and headings",
    async (shape, sequence) => {
      const user = userEvent.setup()
      const { entries, count } = build(shape)
      const { unmount } = render(<MenuButton label="Open" icon="download" items={entries} />)
      try {
        await user.click(screen.getByRole("button", { name: "Open" }))
        let index = 0
        for (const key of sequence) {
          if (key === "{Home}") index = 0
          else if (key === "{End}") index = count - 1
          else index = (index + (key === "{ArrowDown}" ? 1 : -1) + count) % count
        }
        if (sequence.length > 0) await user.keyboard(sequence.join(""))
        expect(screen.getAllByRole("menuitem")).toHaveLength(count)
        expect(screen.getByRole("menuitem", { name: `Item${index}` })).toHaveFocus()
      } finally {
        unmount()
      }
    },
    20_000,
  )
})
