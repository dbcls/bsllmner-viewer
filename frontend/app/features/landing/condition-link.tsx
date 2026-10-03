import type { ReactNode } from "react"
import { Link } from "react-router"

import type { Clause } from "~/lib/api/types"
import { useConditionHref } from "~/lib/condition-href"

type ConditionLinkProps = {
  /** The clauses of the element, whose condition alone the workspace opens with. */
  clauses: Clause[]
  /** False while the element is a previous result on its way out, so that its condition is not asked for. */
  enabled?: boolean
  className: string
  children: ReactNode
}

/**
 * An element that opens the workspace with its condition. The link has its URL before it is pressed, so that it can open
 * in a new tab. Until the api gives the condition, the element is drawn the same, without a link.
 */
export const ConditionLink = ({ clauses, enabled = true, className, children }: ConditionLinkProps) => {
  const href = useConditionHref(clauses, enabled)
  return href ? (
    <Link to={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>
      {children}
    </div>
  )
}
