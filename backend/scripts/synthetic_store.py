"""Build a small synthetic store for local development and end-to-end tests.

Usage (inside the api container): uv run python scripts/synthetic_store.py /data/store/synthetic.duckdb [seed]
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.synthetic import generate

from bsllmner_viewer.build.ingest import build_full
from bsllmner_viewer.build.manifest import load_manifest


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "/data/store/synthetic.duckdb")
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    if out.exists():
        out.unlink()
    with tempfile.TemporaryDirectory(prefix="synthetic-") as tmp:
        dataset = generate(Path(tmp), seed=seed, n_biosamples=600, n_runs=4)
        result = build_full(load_manifest(dataset.manifest), out, workers=1)
    sys.stdout.write(f"{out}: ok={result.ok} {result.counts}\n")
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
