import { ACTION_ICON, MenuButton } from "~/ui"

type FigureExportProps = {
  /** What the figure shows, as the name of the button: "Disease distribution". */
  figure: string
  onTsv: () => void
  onSvg: () => void
  onPng: () => void
}

/** The outputs of a figure, in one Export button in the figure's toolbar. Every figure offers the same formats. */
export const FigureExport = ({ figure, onTsv, onSvg, onPng }: FigureExportProps) => (
  <MenuButton
    label="Export"
    icon={ACTION_ICON.download}
    aria-label={`Export the ${figure}`}
    items={[
      { label: "TSV", hint: "Data table", onSelect: onTsv },
      { label: "SVG", hint: "Vector image", onSelect: onSvg },
      { label: "PNG", hint: "Bitmap image", onSelect: onPng },
    ]}
  />
)
