import { cn } from "./cn"
import { ACTION_ICON, Icon } from "./icons"
import { pageCount, pageRange } from "./page-range"
import { Skeleton } from "./skeleton"

type PagerProps = {
  page: number
  perPage: number
  /** The number of items in the whole list, or undefined while it is being counted. */
  total: number | undefined
  onChange: (page: number) => void
  /** The list could not be loaded: there is no range to show, and no page to step to. */
  failed?: boolean
  /** The name of the navigation landmark. Two pagers on one page need different names. */
  label?: string
}

const STEP =
  "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-button border border-border-soft bg-surface text-ink-mid hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-surface"

const formatCount = (value: number): string => value.toLocaleString("en-US")

/**
 * Which items of a list are on screen (`1–20 / 4,100,500`), and the steps to the previous and the next page. Both steps
 * are always drawn, and a step that leads nowhere is disabled, so the pager keeps its width on every page. While the
 * list is counted, the range is a skeleton and both steps are disabled; a list that could not be loaded shows a dash.
 */
export const Pager = ({ page, perPage, total, onChange, failed = false, label = "Pages" }: PagerProps) => {
  const pages = total === undefined ? page : pageCount(total, perPage)
  const range = total === undefined ? null : pageRange(page, perPage, total)
  return (
    <nav aria-label={label} aria-busy={(total === undefined && !failed) || undefined} className="flex items-center gap-2">
      <span className="text-fs-micro whitespace-nowrap text-ink-soft tabular-nums">
        {failed ? (
          "–"
        ) : total === undefined ? (
          <Skeleton className="w-24" />
        ) : range ? (
          `${formatCount(range.from)}–${formatCount(range.to)} / ${formatCount(total)}`
        ) : (
          `${formatCount(total)} results`
        )}
      </span>
      <span className="flex gap-1">
        <button type="button" className={cn(STEP)} onClick={() => onChange(page - 1)} disabled={failed || page <= 1} aria-label="Previous page">
          <Icon name={ACTION_ICON.goBack} />
        </button>
        <button type="button" className={cn(STEP)} onClick={() => onChange(page + 1)} disabled={failed || page >= pages} aria-label="Next page">
          <Icon name={ACTION_ICON.goTo} />
        </button>
      </span>
    </nav>
  )
}
