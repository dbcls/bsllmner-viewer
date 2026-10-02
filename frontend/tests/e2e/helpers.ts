import { expect, type Locator, type Page } from "@playwright/test"

const POLL = { timeout: 10_000 }

export const paramOf = (page: Page, name: string): string | null => new URL(page.url()).searchParams.get(name)

/** The condition string carried by the current URL. */
export const qOf = (page: Page): string | null => paramOf(page, "q")

export const expectQ = async (page: Page, q: string | null): Promise<void> => {
  await expect.poll(() => qOf(page), POLL).toBe(q)
}

export const expectParam = async (page: Page, name: string, value: string | null): Promise<void> => {
  await expect.poll(() => paramOf(page, name), POLL).toBe(value)
}

/** The workspace URL for a condition and view parameters, encoded as the app writes them. */
export const workspaceUrl = (params: Record<string, string>): string => {
  const search = new URLSearchParams(params).toString()
  return search ? `/entries?${search}` : "/entries"
}

export const conditionRegion = (page: Page): Locator => page.getByRole("region", { name: "Condition" })

export const conditionPanel = (page: Page): Locator => page.getByRole("complementary")

export const termPicker = (page: Page): Locator => page.getByRole("dialog", { name: "Choose a term" })

export const viewTabs = (page: Page): Locator => page.getByRole("navigation", { name: "Views" })

/** The "+ Add" button of one annotation field in the condition panel. */
export const addTermButton = (page: Page, fieldLabel: string): Locator =>
  conditionPanel(page).locator("span").filter({ hasText: new RegExp(`^${fieldLabel}$`) }).locator("..").getByRole("button", { name: "+ Add" })

/** A bar of the distribution tab, found by its exact label. */
export const bar = (page: Page, label: string): Locator =>
  page.getByRole("main").getByRole("button").filter({ has: page.getByText(label, { exact: true }) })

/** A cell of the heatmap, found by its row and column labels. */
export const cell = (page: Page, row: string, col: string): Locator => page.getByTitle(new RegExp(`^${row} × ${col}:`))

/** The header row of one axis card of the heatmap. */
export const axisHeader = (page: Page, side: "Row" | "Column"): Locator =>
  page.getByRole("main").locator("div").filter({ has: page.getByRole("combobox", { name: `${side} dimension` }) }).last()

/** Checks the label that a Select shows for its chosen option. The labels of the other options are in the button but hidden. */
export const expectChosen = async (combobox: Locator, label: string): Promise<void> => {
  await expect(combobox).toHaveText(label, { useInnerText: true })
}

/** Opens a Select and chooses the option with the given label. */
export const choose = async (combobox: Locator, label: string): Promise<void> => {
  await combobox.click()
  await combobox.page().getByRole("listbox").getByRole("option", { name: label, exact: true }).click()
}
