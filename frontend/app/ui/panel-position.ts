/** The edge of the control that an open panel lines up with: the list of a Select starts at the left edge of the Select, and a menu ends at the right edge of its button. */
export type PanelAlign = "left" | "right"

/**
 * Where an open panel sits, fixed to the viewport so that no clipping box hides it: under its control, or over it when
 * there is more room above.
 */
export type PanelPosition = ({ left: number } | { right: number }) & ({ top: number } | { bottom: number }) & { minWidth?: number }

type PanelOptions = {
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
 * under it and there is more room above. With equal room, the panel goes under.
 */
export const panelPositionIn = (box: Box, viewport: Viewport, panelHeight: number, { align, matchWidth }: PanelOptions): PanelPosition => {
  const below = viewport.height - box.bottom
  const above = box.top
  const horizontal = align === "left" ? { left: box.left } : { right: viewport.width - box.right }
  const width = matchWidth ? { minWidth: box.width } : {}
  const vertical = panelHeight + PANEL_GAP > below && above > below ? { bottom: viewport.height - box.top + PANEL_GAP } : { top: box.bottom + PANEL_GAP }
  return { ...horizontal, ...width, ...vertical }
}

/**
 * The position of a panel for a control on screen. A panel whose height is not known yet (0) opens under its control;
 * once it is drawn, its height decides again. The width of the viewport leaves out the scroll bar, so that a panel
 * aligned to the right edge does not slide under the scroll bar.
 */
export const panelPosition = (anchor: HTMLElement, panelHeight: number, options: PanelOptions): PanelPosition =>
  panelPositionIn(anchor.getBoundingClientRect(), { width: document.documentElement.clientWidth, height: window.innerHeight }, panelHeight, options)
