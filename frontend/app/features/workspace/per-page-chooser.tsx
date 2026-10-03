import { TABLE_PER_PAGES, type TablePerPage } from "~/lib/workspace-state"
import { InlineLabel, Select } from "~/ui"

const OPTIONS = TABLE_PER_PAGES.map((perPage) => ({ value: String(perPage), label: String(perPage) }))

type PerPageChooserProps = {
  value: TablePerPage
  onChange: (perPage: TablePerPage) => void
}

/**
 * How many rows a page of a table holds, next to the sort of the table and in the same form. The caller returns to the
 * first page, because the rows that were in view are elsewhere in a list of pages of another size.
 */
export const PerPageChooser = ({ value, onChange }: PerPageChooserProps) => (
  <span className="inline-flex items-center gap-1.5 text-fs-label text-ink-soft">
    <InlineLabel>Per page</InlineLabel>
    <Select
      size="sm"
      options={OPTIONS}
      value={String(value)}
      onChange={(chosen) => onChange(TABLE_PER_PAGES.find((perPage) => String(perPage) === chosen) ?? TABLE_PER_PAGES[0])}
      aria-label="Rows per page"
    />
  </span>
)
