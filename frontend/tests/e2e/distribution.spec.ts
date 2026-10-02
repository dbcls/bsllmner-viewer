import { expect, test } from "@playwright/test"

import { children, distribution, select } from "./_api"
import { bar, expectParam, expectQ, formatCount, statusLabel, workspaceUrl } from "./_helpers"

test.describe("distribution", () => {
  test("clicking a bar adds its clause and keeps the field's other bars under self-exclusion", async ({ page, request }) => {
    const [first] = (await distribution(request, "disease")).elements
    if (!first) throw new Error("the dataset has no disease")
    const q = await select(request, null, first.clauses)
    const after = await distribution(request, "disease", { q })
    const other = after.elements.find((element) => element.value !== first.value)
    if (!other) throw new Error("the distribution of disease has a single element")
    await page.goto(workspaceUrl({ tab: "distribution" }))
    await bar(page, first.label).click()
    await expectQ(page, q)
    await expect(bar(page, first.label)).toHaveAttribute("aria-pressed", "true")
    await expect(bar(page, first.label)).toContainText("in condition")
    await expect(bar(page, first.label)).toContainText(formatCount(after.elements.find((e) => e.value === first.value)?.count ?? first.count))
    await expect(page.getByRole("main").getByText("Not filtered by Disease")).toBeVisible()
    await expect(bar(page, other.label)).toBeVisible()
    await expect(bar(page, other.label)).toHaveAttribute("aria-pressed", "false")
    await expect(bar(page, other.label)).toContainText(formatCount(other.count))
  })

  test("clicking a selected bar removes its clause", async ({ page, request }) => {
    const [first] = (await distribution(request, "disease")).elements
    if (!first) throw new Error("the dataset has no disease")
    const q = await select(request, null, first.clauses)
    await page.goto(workspaceUrl({ tab: "distribution", q }))
    await expect(bar(page, first.label)).toHaveAttribute("aria-pressed", "true")
    await bar(page, first.label).click()
    await expectQ(page, null)
    await expect(bar(page, first.label)).toHaveAttribute("aria-pressed", "false")
  })

  test("turning self-exclusion off restricts the field's own card to the condition", async ({ page, request }) => {
    const [first] = (await distribution(request, "disease")).elements
    if (!first) throw new Error("the dataset has no disease")
    const q = await select(request, null, first.clauses)
    const on = await distribution(request, "disease", { q })
    const off = await distribution(request, "disease", { q, selfExclude: false })
    const gone = on.elements.filter((element) => !off.elements.some((e) => e.value === element.value))
    const [shown] = gone
    if (!shown) throw new Error("self-exclusion hides no element of the disease distribution")
    await page.goto(workspaceUrl({ tab: "distribution", q }))
    await expect(bar(page, shown.label)).toBeVisible()
    await page.getByText("Each view ignores its own filter").click()
    await expectParam(page, "se", "0")
    await expect(page.getByRole("switch")).not.toBeChecked()
    await expect(page.getByText("Each view applies its own filter")).toBeVisible()
    await expect(page.getByRole("main").getByText("Not filtered by Disease")).toHaveCount(0)
    for (const element of off.elements) {
      await expect(bar(page, element.label)).toContainText(formatCount(element.count))
    }
    for (const element of gone) {
      await expect(bar(page, element.label)).toHaveCount(0)
    }
  })

  test("the six statuses replace the three groups when expanded", async ({ page, request }) => {
    const groups = (await distribution(request, "disease")).status
    const states = (await distribution(request, "disease", { expandedStatus: true })).status
    expect(groups).toHaveLength(3)
    expect(states).toHaveLength(6)
    const legend = (statuses: typeof groups) => {
      const sum = statuses.reduce((total, status) => total + status.count, 0)
      return statuses.map((status) => ({ label: statusLabel(status.value), percent: `${Math.round((status.count / sum) * 100)}%` }))
    }
    await page.goto(workspaceUrl({ tab: "distribution" }))
    const main = page.getByRole("main")
    for (const { label, percent } of legend(groups)) {
      await expect(main.getByText(new RegExp(`^${label} \\d+%$`)).first()).toHaveText(`${label} ${percent}`)
    }
    await expect(main.getByText(/^LLM selected /)).toHaveCount(0)
    await main.getByRole("button", { name: "6 states" }).first().click()
    await expectParam(page, "states", "6")
    for (const { label, percent } of legend(states)) {
      await expect(main.getByText(new RegExp(`^${label} \\d+%$`)).first()).toHaveText(`${label} ${percent}`)
    }
    await main.getByRole("button", { name: "3 groups" }).first().click()
    await expectParam(page, "states", null)
    await expect(main.getByText(/^LLM selected /)).toHaveCount(0)
  })

  test("a bar with child terms expands them below it and records the expansion in the URL", async ({ page, request }) => {
    const top = (await distribution(request, "disease")).elements
    const parent = top.find((element) => element.hasChildren)
    if (!parent) throw new Error("no disease bar has child terms")
    const child = (await children(request, "disease", parent.value)).find((c) => !top.some((element) => element.value === c.value))
    if (!child) throw new Error(`every child of ${parent.value} is already a bar`)
    await page.goto(workspaceUrl({ tab: "distribution" }))
    const main = page.getByRole("main")
    await expect(bar(page, parent.label)).toBeVisible()
    await expect(main.getByText(child.label, { exact: true })).toHaveCount(0)
    await bar(page, parent.label).getByRole("button", { name: "Expand child terms" }).click()
    await expectParam(page, "expand", `disease:${parent.value}`)
    await expect(bar(page, child.label)).toContainText(formatCount(child.count))
    await bar(page, parent.label).getByRole("button", { name: "Collapse child terms" }).click()
    await expectParam(page, "expand", null)
    await expect(main.getByText(child.label, { exact: true })).toHaveCount(0)
  })
})
