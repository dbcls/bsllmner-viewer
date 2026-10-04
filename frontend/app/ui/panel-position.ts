import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

/**
 * The edge of the control that an open panel is aligned to. `left` starts the panel at the left edge of the control.
 * `right` ends it at the right edge.
 */
type PanelAlign = "left" | "right"

/**
 * Where an open panel sits, fixed to the viewport so that no clipping box hides it: under its control, or over it when
 * there is more room above.
 */
export type PanelPosition = ({ left: number } | { right: number }) & ({ top: number } | { bottom: number }) & { minWidth?: number }

export type PanelOptions = {
  align: PanelAlign
  /** The panel is at least as wide as its control. */
  matchWidth: boolean
}

type Box = Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width">

type Viewport = { width: number; height: number }

/** The space between a control and its panel. */
export const PANEL_GAP = 4

/**
 * The position of a panel of the given height for a control at `box`: under the control, unless the panel does not fit
 * under it and there is more room above. With equal room, the panel goes under. A panel aligned to the left edge of
 * its control that would cross the right edge of the viewport is aligned to the right edge of the control instead,
 * when it fits there. A width of 0 means that the width is not known yet.
 */
export const panelPositionIn = (
  box: Box,
  viewport: Viewport,
  panelHeight: number,
  { align, matchWidth }: PanelOptions,
  panelWidth = 0,
): PanelPosition => {
  const below = viewport.height - box.bottom
  const above = box.top
  const crossesRight = box.left + panelWidth > viewport.width && box.right - panelWidth >= 0
  const horizontal = align === "left" && !crossesRight ? { left: box.left } : { right: viewport.width - box.right }
  const width = matchWidth ? { minWidth: box.width } : {}
  const vertical = panelHeight + PANEL_GAP > below && above > below ? { bottom: viewport.height - box.top + PANEL_GAP } : { top: box.bottom + PANEL_GAP }
  return { ...horizontal, ...width, ...vertical }
}

/**
 * The position of a panel for a control on screen. A panel whose height is not known yet (0) opens under its control;
 * once it is drawn, its height decides again. The width of the viewport omits the scroll bar, so that a panel
 * aligned to the right edge does not slide under the scroll bar.
 */
export const panelPosition = (anchor: HTMLElement, panelHeight: number, options: PanelOptions, panelWidth = 0): PanelPosition =>
  panelPositionIn(anchor.getBoundingClientRect(), { width: document.documentElement.clientWidth, height: window.innerHeight }, panelHeight, options, panelWidth)

/**
 * The position of a panel that follows its anchor while it is open. The position is measured when the panel opens and
 * again whenever the page scrolls or the window resizes, from the size the panel has by then. `measure` sets the
 * position at once, so that a caller can give a panel its first position before it is drawn. With `measureWidth`, the
 * width of the drawn panel also decides where it fits.
 */
export const useAnchoredPosition = (
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  place: PanelOptions,
  measureWidth = false,
) => {
  const [position, setPosition] = useState<PanelPosition | null>(null)

  const measure = useCallback(() => {
    if (!anchorRef.current) return
    const panel = panelRef.current
    setPosition(panelPosition(anchorRef.current, panel?.offsetHeight ?? 0, place, measureWidth ? (panel?.offsetWidth ?? 0) : 0))
  }, [anchorRef, panelRef, place, measureWidth])

  useLayoutEffect(() => {
    if (!open) return
    measure()
    window.addEventListener("scroll", measure, true)
    window.addEventListener("resize", measure)
    return () => {
      window.removeEventListener("scroll", measure, true)
      window.removeEventListener("resize", measure)
    }
  }, [open, measure])

  return { position, measure }
}

/**
 * Calls `onOutside` when a mouse or touch press starts outside every element of `refs`, while `open` is true. The
 * latest `refs` and `onOutside` are used, so a caller does not need to keep them stable.
 */
export const useOutsidePointer = (open: boolean, refs: readonly RefObject<HTMLElement | null>[], onOutside: () => void) => {
  const latest = useRef({ refs, onOutside })
  useLayoutEffect(() => {
    latest.current = { refs, onOutside }
  })

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node
      if (!latest.current.refs.some((ref) => ref.current?.contains(target))) latest.current.onOutside()
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
    }
  }, [open])
}
