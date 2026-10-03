import { expect, type Locator, type Page } from "@playwright/test"

const POLL = { timeout: 15_000 }

/** A count as the UI writes it. */
export const formatCount = (value: number): string => value.toLocaleString("en-US")

/** The rows on one page of the tables (Samples and Projects) when no other number is chosen. */
export const TABLE_PER_PAGE = 20

/** The range of a page of a table as the pager writes it, for example `1–20 / 4,100,500`. */
export const pageRangeText = (total: number, page = 1, perPage = TABLE_PER_PAGE): string => {
  if (total === 0) return "0 results"
  const from = (page - 1) * perPage + 1
  return `${formatCount(from)}–${formatCount(Math.min(page * perPage, total))} / ${formatCount(total)}`
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const paramOf = (page: Page, name: string): string | null => new URL(page.url()).searchParams.get(name)

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

/**
 * Waits until the condition bar has its counts, which means that the page is interactive. The count and its unit are
 * separate elements, so the text has no space between them.
 */
export const expectCounted = async (page: Page): Promise<void> => {
  await expect(conditionRegion(page)).toContainText(/\d+\s*BioSamples/)
}

export const conditionPanel = (page: Page): Locator => page.getByRole("complementary")

export const termPicker = (page: Page): Locator => page.getByRole("dialog", { name: "Add an annotation term" })

export const viewTabs = (page: Page): Locator => page.getByRole("navigation", { name: "Views" })

/** The "Add term" button under the "Annotation terms" heading of the condition panel, which opens the term picker. */
export const addTermButton = (page: Page): Locator => conditionPanel(page).getByRole("button", { name: "Add term", exact: true })

/** A bar of the distribution tab, found by its exact label. */
export const bar = (page: Page, label: string): Locator =>
  page.getByRole("main").getByRole("button").filter({ has: page.getByText(label, { exact: true }) })

/** A cell of the heatmap, found by its row and column labels. */
export const cell = (page: Page, row: string, col: string): Locator =>
  page.getByRole("cell", { name: new RegExp(`^${escapeRegExp(row)} × ${escapeRegExp(col)}:`) })

/** The button of a populated heatmap cell. */
export const cellButton = (page: Page, row: string, col: string): Locator =>
  page.getByRole("button", { name: new RegExp(`^${escapeRegExp(row)} × ${escapeRegExp(col)}:`) })

/** The controls of one axis of a chart view: its name, its dimension, and the button that opens its terms. */
const axisControls = (page: Page, side: "Rows" | "Columns" | "Lines"): Locator => page.getByRole("group", { name: side })

/** The button of an axis of a chart view that shows the number of its terms and opens them. */
export const axisTermsButton = (page: Page, side: "Rows" | "Columns" | "Lines"): Locator => axisControls(page, side).getByRole("button", { name: /^\d+ terms?$/ })

/** The dialog of the terms of a heatmap axis, with the ways to change them. */
export const axisTerms = (page: Page, side: "Rows" | "Columns"): Locator => page.getByRole("dialog", { name: side === "Rows" ? "Row terms" : "Column terms" })

/** Checks the label that a Select shows for its chosen option. The labels of the other options are in the button but hidden. */
export const expectChosen = async (combobox: Locator, label: string): Promise<void> => {
  await expect(combobox).toHaveText(label, { useInnerText: true })
}

/** Opens a Select and chooses the option with the given label. */
export const choose = async (combobox: Locator, label: string): Promise<void> => {
  await combobox.click()
  await combobox.page().getByRole("listbox").getByRole("option", { name: label, exact: true }).click()
}

const FIELD_LABELS: Record<string, string> = {
  library_strategy: "Assay",
  organism_id: "Organism",
  date_published: "Year",
  chip_antigen: "ChIP antigen",
}

/** The label that the UI shows for a field of the api. */
export const fieldLabel = (field: string): string =>
  FIELD_LABELS[field] ?? field.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
