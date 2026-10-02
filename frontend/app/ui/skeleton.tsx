import { cn } from "./cn"

type SkeletonProps = {
  /**
   * `text` stands for one line of text: it keeps the height of a line of the surrounding font, so a row of skeletons is
   * as tall as the row of text that replaces it. `block` stands for a box whose height comes from `className`.
   */
  kind?: "text" | "block"
  /** The width, and for `block` also the height, such as `w-24` or `h-2 w-full`. */
  className?: string
}

const ZERO_WIDTH_SPACE = "\u200b"

/**
 * The place of content that is on its way, drawn at the size the content will take, so that nothing around it moves when
 * the content arrives. Hidden from assistive technology; the region that waits says so with `aria-busy`.
 */
export const Skeleton = ({ kind = "text", className }: SkeletonProps) =>
  kind === "text" ? (
    <span aria-hidden="true" className="block">
      {ZERO_WIDTH_SPACE}
      <span className={cn("inline-block h-[0.75em] animate-pulse rounded-badge bg-skeleton align-middle", className ?? "w-full")} />
    </span>
  ) : (
    <span aria-hidden="true" className={cn("block animate-pulse rounded-badge bg-skeleton", className)} />
  )

/**
 * The classes of a region that shows a previous result while the next one is on its way: the content stays and turns
 * pale, after a short delay so that a fast answer does not make it blink. Pair it with `aria-busy`.
 */
export const busyClass = (busy: boolean): string =>
  busy ? "transition-opacity opacity-55 delay-200 duration-300" : "transition-opacity duration-150"
