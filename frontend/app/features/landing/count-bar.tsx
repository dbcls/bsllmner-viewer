import { cn, Skeleton } from "~/ui"

/** The vertical padding of a row: `sm` for the rows of the statistics, `md` for the rows of the field list. */
type CountBarPadding = "sm" | "md"

const ROW_PADDING: Record<CountBarPadding, string> = { sm: "py-0.5", md: "py-1" }

/** The class of a pressable row of a count bar. */
export const countBarRowClass = (padding: CountBarPadding): string =>
  cn("flex w-full cursor-pointer items-center gap-2 rounded-tag text-left hover:bg-brand-soft", ROW_PADDING[padding])

type CountBarProps = {
  label: string
  /** The count, formatted. */
  count: string
  /** The bar's length, from 0 to 1. */
  ratio: number
}

/** The content of a count bar row: the label over a bar, and the count at the right edge. */
export const CountBar = ({ label, count, ratio }: CountBarProps) => (
  <>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-fs-body-sm">{label}</span>
      <span className="mt-0.5 block h-1.5 overflow-hidden rounded-badge bg-brand-soft">
        <span className="block h-full bg-brand-light" style={{ width: `${ratio * 100}%` }} />
      </span>
    </span>
    <span className="w-17 shrink-0 text-right font-mono text-fs-label text-ink-mid">{count}</span>
  </>
)

/** A count bar row before its numbers arrive. */
export const CountBarSkeleton = ({ padding }: { padding: CountBarPadding }) => (
  <div aria-hidden="true" className={cn("flex items-center gap-2", ROW_PADDING[padding])}>
    <span className="min-w-0 flex-1">
      <span className="block text-fs-body-sm">
        <Skeleton className="w-24" />
      </span>
      <Skeleton kind="block" className="mt-0.5 h-1.5 w-full" />
    </span>
    <span className="flex w-17 shrink-0 justify-end text-fs-label">
      <Skeleton className="w-12" />
    </span>
  </div>
)
