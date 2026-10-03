import { expect, type Locator, type Page, test } from "@playwright/test"

import { dataset, distribution, select } from "./_api"
import { conditionPanel, conditionRegion, workspaceUrl } from "./_helpers"

/** Whether the focus ring around the element (an outline and a ring of 4px, 5px out from its box) is drawn whole, not cut off by a box that clips its content. */
const ringIsWhole = (element: Locator): Promise<boolean> =>
  element.evaluate((target) => {
    const ring = 5
    const box = target.getBoundingClientRect()
    for (let node = target.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflowX === "visible" && style.overflowY === "visible") continue
      const clip = node.getBoundingClientRect()
      if (box.left - ring < clip.left || box.right + ring > clip.right || box.top - ring < clip.top || box.bottom + ring > clip.bottom) return false
    }
    return true
  })

/** Whether the element draws an outline now. */
const hasOutline = (element: Locator): Promise<boolean> => element.evaluate((target) => getComputedStyle(target).outlineStyle !== "none")

/** The element that a press at the point of the page reaches. */
const pressed = (page: Page, x: number, y: number) => page.evaluate(({ px, py }) => document.elementFromPoint(px, py)?.outerHTML.slice(0, 80) ?? "", { px: x, py: y })

test.describe("layout", () => {
  test("the skip link shows when it has the focus, and leads to the main content", async ({ page }) => {
    await page.goto("/")
    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "Skip to main content" })
    await expect(skip).toBeFocused()
    const box = await skip.boundingBox()
    expect(box?.width).toBeGreaterThan(40)
    expect(box?.height).toBeGreaterThan(10)
    await expect(page.locator("main#main")).toHaveCount(1)
  })

  test("the values of an annotation stay inside their cell, cut with an ellipsis when they are longer", async ({ page, request }) => {
    const [cellLine] = (await distribution(request, "cell_line")).elements
    if (!cellLine) throw new Error("the dataset has no cell line")
    await page.goto(workspaceUrl({ q: await select(request, null, cellLine.clauses), perPage: "100" }))
    const items = page.getByRole("main").locator("tbody td li")
    await expect(items.first()).toBeVisible()
    const outside = await items.evaluateAll((elements) =>
      elements.filter((element) => element.getBoundingClientRect().right > (element.closest("td") as HTMLElement).getBoundingClientRect().right + 0.5).length,
    )
    expect(outside).toBe(0)
  })

  test("the focus rings of a segmented control, a checkbox, and a switch are drawn whole", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "distribution" }))
    const visual = conditionRegion(page).getByRole("radio", { name: "Visual" })
    await visual.focus()
    expect(await hasOutline(visual)).toBe(true)
    expect(await ringIsWhole(visual)).toBe(true)
    const checkbox = conditionPanel(page).getByRole("checkbox").first()
    await checkbox.focus()
    const box = checkbox.locator("..")
    expect(await hasOutline(box)).toBe(true)
    expect(await ringIsWhole(box)).toBe(true)
    const termIds = page.getByRole("switch", { name: "Term IDs" })
    await termIds.focus()
    const track = termIds.locator("..")
    expect(await hasOutline(track)).toBe(true)
    expect(await ringIsWhole(track)).toBe(true)
  })

  test("the help button takes a press 11px away from its center", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "distribution" }))
    const help = page.getByRole("button", { name: "About the counts" })
    const box = await help.boundingBox()
    if (!box) throw new Error("the help button is not drawn")
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
    for (const [dx, dy] of [[11, 0], [-11, 0], [0, 11], [0, -11]] as const) {
      expect(await pressed(page, x + dx, y + dy)).toContain('aria-label="About the counts"')
    }
  })

  test("a press at the center of a point of the trend reaches a point that is drawn, not the area around another point", async ({ page }) => {
    await page.goto(workspaceUrl({ tab: "trend", trend_all: "on" }))
    const points = page.getByRole("main").locator('svg g[role="button"]')
    await expect(points.first()).toBeVisible()
    // Points of two lines can be drawn over each other; a press then reaches the one on top, which is still a point.
    const taken = await points.evaluateAll((groups) =>
      groups.filter((group) => {
        const dot = group.lastElementChild as SVGCircleElement
        const box = dot.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return hit?.getAttribute("fill") === "transparent"
      }).length,
    )
    expect(taken).toBe(0)
  })

  test("buttons that look alike are as tall as one another, and so are tags", async ({ page, request }) => {
    const [assay] = (await dataset(request)).targetAssays
    if (!assay) throw new Error("the dataset has no target assay")
    await page.goto(workspaceUrl({}))
    const header = await page.getByRole("navigation", { name: "Primary" }).getByRole("link").first().boundingBox()
    const addTerm = await conditionPanel(page).getByRole("button", { name: "Add term", exact: true }).boundingBox()
    expect(header?.height).toBe(addTerm?.height)
    const tag = await conditionPanel(page).getByText(assay, { exact: true }).boundingBox()
    expect(tag?.height).toBe(20)
  })
})
