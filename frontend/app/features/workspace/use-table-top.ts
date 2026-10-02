import { useRef } from "react"

/**
 * The page change of the pager under a table. If the top of the table is above the window, the window scrolls back to
 * it, where the new page starts. The pager over the table keeps the window where it is.
 */
export const useTableTop = (onPage: (page: number) => void) => {
  const ref = useRef<HTMLDivElement>(null)
  const onFootPage = (page: number) => {
    onPage(page)
    const top = ref.current
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" })
  }
  return { ref, onFootPage }
}
