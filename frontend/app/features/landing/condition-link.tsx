import type { ReactNode } from "react"
import { Link } from "react-router"

import type { Clause } from "~/lib/api/types"
import { useConditionHref } from "~/lib/condition-href"
import { crawlRel } from "~/lib/site"
import { cn } from "~/ui"

type ConditionLinkProps = {
  /** The clauses of the element, whose condition alone the workspace opens with. */
  clauses: Clause[]
  /**
   * False while the element shows a previous result that is being replaced, so that the page does not request its
   * condition.
   */
  enabled?: boolean
  className: string
  children: ReactNode
}

/**
 * An element that opens the workspace with its condition. The link has its URL before it is pressed, so that it can open
 * in a new tab. Before the api returns the condition, the element looks the same but has no link. If the api cannot
 * return the condition, the element is marked as unavailable.
 */
export const ConditionLink = ({ clauses, enabled = true, className, children }: ConditionLinkProps) => {
  const { href, failed } = useConditionHref(clauses, enabled)
  return href ? (
    <Link to={href} rel={crawlRel(href)} className={className}>
      {children}
    </Link>
  ) : (
    <div className={cn(className, failed && "opacity-55")} {...(failed ? { "aria-disabled": true } : {})}>
      {children}
    </div>
  )
}
