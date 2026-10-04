import { TABLE_PER_PAGES, type TablePerPage } from "~/lib/workspace-state"
import { InlineLabel, Select } from "~/ui"

const OPTIONS = TABLE_PER_PAGES.map((perPage) => ({ value: String(perPage), label: String(perPage) }))

type PerPageChooserProps = {
  value: TablePerPage
  onChange: (perPage: TablePerPage) => void
}

/**
 * A control for the number of rows per page of a table. The control has the same form as SortChooser: a label and a
 * small Select.
 * The caller returns to the first page, because the rows that were in view are on a different page at the new page size.
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
