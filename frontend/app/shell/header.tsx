import { Link } from "react-router"

const DOCS_URL = "https://github.com/dbcls/bsllmner-viewer#documentation"

export const Header = () => (
  <header className="flex h-header shrink-0 items-center justify-between border-b border-border-soft bg-surface px-workspace-gutter">
    <Link to="/" className="text-fs-brand font-bold tracking-h1 text-brand no-underline hover:text-brand-deep">
      bsllmner-viewer
    </Link>
    <nav aria-label="Primary" className="flex gap-4 text-fs-body-sm">
      <a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-brand no-underline hover:text-brand-deep">
        Docs
      </a>
    </nav>
  </header>
)
