import { assayDotClass, orderAssays } from "~/lib/assays"
import { Tag } from "~/ui"

type AssayTagProps = {
  assay: string
  /** The target assays of the dataset, which decide the color of the dot. */
  targetAssays: readonly string[]
}

/** One assay as a tag with the dot of its color. */
export const AssayTag = ({ assay, targetAssays }: AssayTagProps) => <Tag dot={assayDotClass(assay, targetAssays)}>{assay}</Tag>

type AssayTagsProps = {
  assays: readonly string[]
  /** The target assays of the dataset, whose order the tags follow. */
  targetAssays: readonly string[]
}

/** The assays of a table row as tags, one per line, in the order of the dataset's target assays. */
export const AssayTags = ({ assays, targetAssays }: AssayTagsProps) => (
  <span className="flex flex-col items-start gap-1">
    {orderAssays(assays, targetAssays).map((assay) => (
      <AssayTag key={assay} assay={assay} targetAssays={targetAssays} />
    ))}
  </span>
)
