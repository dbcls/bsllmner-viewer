import { fc, test } from "@fast-check/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, vi } from "vitest"

import { Select } from "~/ui/select"

type Key = "{ArrowDown}" | "{ArrowUp}" | "{Home}" | "{End}"

const options = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 8 }).map((values) =>
  values.map((value) => ({ value, label: value.toUpperCase() })),
)
const keys = fc.array(fc.constantFrom<Key>("{ArrowDown}", "{ArrowUp}", "{Home}", "{End}"), { maxLength: 12 })

/** The option that the keys reach: the first key opens the list at the chosen option, and the list does not wrap. */
const reached = (start: number, count: number, sequence: Key[]): number => {
  let index = start
  sequence.forEach((key, position) => {
    if (key === "{Home}") index = 0
    else if (key === "{End}") index = count - 1
    else if (position > 0) index = Math.min(Math.max(index + (key === "{ArrowDown}" ? 1 : -1), 0), count - 1)
  })
  return index
}

describe("Select", () => {
  test.prop([options.chain((list) => fc.tuple(fc.constant(list), fc.nat({ max: list.length - 1 }), keys))], { numRuns: 40 })(
    "chooses the option that the arrow keys, Home, and End reach, and reports only a change of the value",
    async ([list, start, sequence]) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const initial = list[start]?.value ?? ""
      render(<Select options={list} value={initial} onChange={onChange} aria-label="Field" />)
      screen.getByRole("combobox", { name: "Field" }).focus()
      await user.keyboard(`${sequence.length === 0 ? "{ArrowDown}" : sequence.join("")}{Enter}`)
      const expected = list[reached(start, list.length, sequence)]?.value
      if (expected === initial) expect(onChange).not.toHaveBeenCalled()
      else expect(onChange).toHaveBeenCalledExactlyOnceWith(expected)
      expect(screen.queryByRole("listbox")).toBeNull()
      cleanup()
    },
  )
})
