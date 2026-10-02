import { TABLE_PER_PAGE } from "~/lib/workspace-state"
import { FrozenTd, Skeleton } from "~/ui"

type SkeletonTableRowsProps = {
  /** The width class of the skeleton in each column, near the width of the column's values. */
  columns: readonly string[]
  /** The first column stays put when the table scrolls sideways, as the first column of the table's rows does. */
  frozen?: boolean
}

/** A page of skeleton rows of a table, each as tall as a row of the table, while the first page of a condition loads. */
export const SkeletonTableRows = ({ columns, frozen = false }: SkeletonTableRowsProps) => (
  <>
    {Array.from({ length: TABLE_PER_PAGE }, (_, index) => (
      <tr key={index} aria-hidden="true" className="group">
        {columns.map((width, column) =>
          frozen && column === 0 ? (
            <FrozenTd key={column} className={SKELETON_CELL}>
              <Skeleton className={width} />
            </FrozenTd>
          ) : (
            <td key={column} className={SKELETON_CELL}>
              <Skeleton className={width} />
            </td>
          ),
        )}
      </tr>
    ))}
  </>
)

/**
 * The rule is on the cells rather than the row, so that it is drawn in a table with separate borders as well. The last row
 * has none, so that it does not double the line over the footer.
 */
const SKELETON_CELL = "border-b border-brand-soft px-2.5 py-1.5 group-last:border-b-0"
