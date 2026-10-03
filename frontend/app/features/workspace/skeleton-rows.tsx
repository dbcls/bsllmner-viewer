import { FrozenTd, Skeleton } from "~/ui"

import { TABLE_CELL } from "./table"

type SkeletonTableRowsProps = {
  /** The rows that a page of the table holds. */
  rows: number
  /** The width class of the skeleton in each column, near the width of the column's values. */
  columns: readonly string[]
  /** The first column stays put when the table scrolls sideways, as the first column of the table's rows does. */
  frozen?: boolean
}

/** A page of skeleton rows of a table, each as tall as a row of the table, while the first page of a condition loads. */
export const SkeletonTableRows = ({ rows, columns, frozen = false }: SkeletonTableRowsProps) => (
  <>
    {Array.from({ length: rows }, (_, index) => (
      <tr key={index} aria-hidden="true" className="group">
        {columns.map((width, column) =>
          frozen && column === 0 ? (
            <FrozenTd key={column} className={TABLE_CELL}>
              <Skeleton className={width} />
            </FrozenTd>
          ) : (
            <td key={column} className={TABLE_CELL}>
              <Skeleton className={width} />
            </td>
          ),
        )}
      </tr>
    ))}
  </>
)
