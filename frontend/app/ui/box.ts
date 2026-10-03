/**
 * The size of a box that takes a value (Select, TextInput). `md` is a box that a search is typed into, and the Select that
 * chooses what that box searches. `sm` is a filter or a setting of a view. A row holds boxes of one size only.
 */
export type BoxSize = "sm" | "md"

export const BOX_SIZE: Record<BoxSize, string> = {
  sm: "h-box-sm text-fs-label",
  md: "h-box-md text-fs-body",
}

/**
 * The focus of every box (Select, TextInput, TextArea): the edge turns brand and a brand-tint halo appears, in place of
 * the double ring of a button. The box draws its own unfocused edge, so that an open Select can draw its edge brand.
 */
export const BOX_FOCUS = "focus-visible:border-brand focus-visible:shadow-box-focus focus-visible:outline-none"
