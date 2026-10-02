import { Link } from "react-router"

import { ACTION_ICON, ExternalLink } from "~/ui"

const REPOSITORY_URL = "https://github.com/dbcls/bsllmner-viewer"
const API_URL = "/api"

export const Header = () => (
  <header className="flex h-header shrink-0 items-center justify-between border-b border-border-soft bg-surface px-workspace-gutter">
    <Link to="/" className="font-mono text-fs-brand font-medium tracking-brand text-ink no-underline hover:text-brand-deep">
      bsllmner-viewer
    </Link>
    <nav aria-label="Primary" className="flex gap-2">
      <ExternalLink kind="button" href={REPOSITORY_URL} icon={ACTION_ICON.openRepository}>
        GitHub
      </ExternalLink>
      <ExternalLink kind="button" href={API_URL} icon={ACTION_ICON.openApiDocs}>
        API
      </ExternalLink>
    </nav>
  </header>
)
