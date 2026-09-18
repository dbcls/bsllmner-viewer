import { cn } from "./cn"

type PagerProps = {
  page: number
  pages: number
  onChange: (page: number) => void
}

export const Pager = ({ page, pages, onChange }: PagerProps) => {
  const arrow = "cursor-pointer rounded-button border border-border-soft bg-surface px-2.5 py-1 text-fs-label text-ink-mid hover:bg-brand-soft disabled:cursor-default disabled:opacity-40"
  return (
    <div className="flex items-center gap-1.5 text-fs-label text-ink-soft">
      <button type="button" className={cn(arrow)} onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
        ‹
      </button>
      <span>
        Page {page.toLocaleString("en-US")} of {Math.max(1, pages).toLocaleString("en-US")}
      </span>
      <button type="button" className={cn(arrow)} onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label="Next page">
        ›
      </button>
    </div>
  )
}
