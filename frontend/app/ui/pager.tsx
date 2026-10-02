import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"
import { pageCount, pageRange } from "./page-range"

type PagerProps = {
  page: number
  perPage: number
  /** The number of items in the whole list, or undefined while it is being counted. */
  total: number | undefined
  onChange: (page: number) => void
}

const STEP =
  "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-button border border-border-soft bg-surface text-ink-mid hover:bg-brand-soft disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface"

const formatCount = (value: number): string => value.toLocaleString("en-US")

/**
 * Which items of a list are on screen (`1–20 / 4,100,500`), and the steps to the previous and the next page. Both steps
 * are always drawn, and a step that leads nowhere is disabled, so the pager keeps its width on every page.
 */
export const Pager = ({ page, perPage, total, onChange }: PagerProps) => {
  if (total === undefined) {
    return <div className="flex min-h-7 items-center text-fs-label text-ink-soft">Counting…</div>
  }
  const pages = pageCount(total, perPage)
  const range = pageRange(page, perPage, total)
  return (
    <nav aria-label="Pages" className="flex items-center gap-2">
      <span className="text-fs-micro whitespace-nowrap text-ink-soft tabular-nums">
        {range ? `${formatCount(range.from)}–${formatCount(range.to)} / ${formatCount(total)}` : `${formatCount(total)} results`}
      </span>
      <span className="flex gap-1">
        <button type="button" className={cn(STEP)} onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page" title="Previous page">
          <Icon name={ACTION_ICON.goBack} />
        </button>
        <button type="button" className={cn(STEP)} onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label="Next page" title="Next page">
          <Icon name={ACTION_ICON.goTo} />
        </button>
      </span>
    </nav>
  )
}
