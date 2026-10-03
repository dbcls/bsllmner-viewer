import { Link } from "react-router"

import { ACTION_ICON, ExternalLink } from "~/ui"

/** The repositories of the viewer and of the pipeline that produces its annotations, each named by its GitHub path. */
const REPOSITORIES = ["dbcls/bsllmner-viewer", "dbcls/bsllmner-mk2"]
const API_URL = "/api"

export const Header = () => (
  <header className="flex h-header shrink-0 items-center justify-between border-b border-border-soft bg-surface px-workspace-gutter">
    <Link to="/" className="font-mono text-fs-brand font-medium tracking-brand text-ink no-underline hover:text-brand-deep">
      bsllmner-viewer
    </Link>
    <nav aria-label="Primary" className="flex gap-2">
      {REPOSITORIES.map((repository) => (
        <ExternalLink key={repository} kind="button" href={`https://github.com/${repository}`} icon={ACTION_ICON.openRepository}>
          {repository}
        </ExternalLink>
      ))}
      <ExternalLink kind="button" href={API_URL} icon={ACTION_ICON.openApiDocs}>
        API
      </ExternalLink>
    </nav>
  </header>
)
