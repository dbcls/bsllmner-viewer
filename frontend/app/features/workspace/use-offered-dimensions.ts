import { useEffect } from "react"

import type { Update, WorkspaceState } from "./state"
import { offeredDimensionsPatch } from "./view-requests"

/**
 * Replaces a dimension of the URL that the dataset does not offer with the dimension that the view draws, so that the URL
 * and the view mean the same. It waits for the dataset of the server: the copy of the last visit can be out of date.
 */
export const useReplaceUnofferedDimensions = (
  state: WorkspaceState,
  update: Update,
  dataset: { data: { fields: { name: string }[] } | undefined; isPlaceholderData: boolean },
): void => {
  const fields = dataset.data && !dataset.isPlaceholderData ? dataset.data.fields.map((f) => f.name) : null
  const patch = offeredDimensionsPatch(state, fields)
  const key = patch === null ? null : JSON.stringify(patch)
  useEffect(() => {
    if (patch !== null) update(patch, { replace: true })
    // The patch is written once for each distinct patch; the callback only writes the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
