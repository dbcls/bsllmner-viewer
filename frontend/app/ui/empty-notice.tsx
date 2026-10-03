import type { ReactNode } from "react"

/** The sentence in the place of a list, table, or chart that has nothing to show, such as "No BioSamples match this condition." */
export const EmptyNotice = ({ children }: { children: ReactNode }) => <div className="px-4 py-6 text-fs-body-sm text-ink-soft">{children}</div>
