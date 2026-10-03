import { fc, test } from "@fast-check/vitest"
import { describe, expect, it } from "vitest"

import { PANEL_GAP, panelPositionIn } from "~/ui/panel-position"

type Scene = {
  box: { top: number; bottom: number; left: number; right: number; width: number }
  viewport: { width: number; height: number }
  panelHeight: number
  align: "left" | "right"
  matchWidth: boolean
}

/** A control somewhere on screen, the viewport, and a panel of any height, aligned to either edge. */
const scene: fc.Arbitrary<Scene> = fc
  .record({ width: fc.integer({ min: 320, max: 3000 }), height: fc.integer({ min: 200, max: 2000 }) })
  .chain((viewport) =>
    fc.record({
      viewport: fc.constant(viewport),
      top: fc.integer({ min: 0, max: viewport.height - 1 }),
      controlHeight: fc.integer({ min: 1, max: 80 }),
      left: fc.integer({ min: 0, max: viewport.width - 1 }),
      controlWidth: fc.integer({ min: 1, max: 600 }),
      panelHeight: fc.integer({ min: 0, max: 2500 }),
      align: fc.constantFrom<"left" | "right">("left", "right"),
      matchWidth: fc.boolean(),
    }),
  )
  .map(({ viewport, top, controlHeight, left, controlWidth, panelHeight, align, matchWidth }) => ({
    box: { top, bottom: top + controlHeight, left, right: left + controlWidth, width: controlWidth },
    viewport,
    panelHeight,
    align,
    matchWidth,
  }))

const positionOf = (s: Scene) => panelPositionIn(s.box, s.viewport, s.panelHeight, { align: s.align, matchWidth: s.matchWidth })

describe("panelPositionIn", () => {
  test.prop([scene])("opens under the control unless the panel does not fit there and there is more room above", (s) => {
    const position = positionOf(s)
    const below = s.viewport.height - s.box.bottom
    if (s.panelHeight + PANEL_GAP <= below || s.box.top <= below) {
      expect(position).toMatchObject({ top: s.box.bottom + PANEL_GAP })
      expect(position).not.toHaveProperty("bottom")
    } else {
      expect(position).toMatchObject({ bottom: s.viewport.height - s.box.top + PANEL_GAP })
      expect(position).not.toHaveProperty("top")
    }
  })

  test.prop([scene])("keeps a panel that fits under its control inside the viewport", (s) => {
    const position = positionOf(s)
    if (s.panelHeight + PANEL_GAP <= s.viewport.height - s.box.bottom) {
      expect(position).toHaveProperty("top")
      if ("top" in position) expect(position.top + s.panelHeight).toBeLessThanOrEqual(s.viewport.height)
    }
  })

  test.prop([scene])("lines the panel up with the chosen edge of the control and sets no other horizontal edge", (s) => {
    const position = positionOf(s)
    if (s.align === "left") {
      expect(position).toMatchObject({ left: s.box.left })
      expect(position).not.toHaveProperty("right")
    } else {
      expect(position).toMatchObject({ right: s.viewport.width - s.box.right })
      expect(position).not.toHaveProperty("left")
    }
  })

  test.prop([scene])("makes the panel at least as wide as the control only when asked", (s) => {
    const position = positionOf(s)
    if (s.matchWidth) expect(position).toMatchObject({ minWidth: s.box.width })
    else expect(position).not.toHaveProperty("minWidth")
  })

  const viewport = { width: 1000, height: 800 }
  const options = { align: "left", matchWidth: false } as const

  it("opens under the control when the panel and the gap fill the room under it exactly", () => {
    const box = { top: 400, bottom: 428, left: 40, right: 200, width: 160 }
    const room = viewport.height - box.bottom
    expect(panelPositionIn(box, viewport, room - PANEL_GAP, options)).toMatchObject({ top: box.bottom + PANEL_GAP })
  })

  it("opens over the control when the panel is one pixel too tall and the room over it is larger", () => {
    const box = { top: 400, bottom: 428, left: 40, right: 200, width: 160 }
    const room = viewport.height - box.bottom
    expect(panelPositionIn(box, viewport, room - PANEL_GAP + 1, options)).toMatchObject({ bottom: viewport.height - box.top + PANEL_GAP })
  })

  it("opens under the control when the panel is too tall and the room over it is the same as under it", () => {
    const box = { top: 386, bottom: 414, left: 40, right: 200, width: 160 }
    expect(viewport.height - box.bottom).toBe(box.top)
    expect(panelPositionIn(box, viewport, box.top, options)).toMatchObject({ top: box.bottom + PANEL_GAP })
  })
})
