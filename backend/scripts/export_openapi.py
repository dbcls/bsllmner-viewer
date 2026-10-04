"""Write the OpenAPI document of the api to backend/openapi.json.

The frontend generates its API types from this file, and a backend test checks that the file is the document of the
api. Usage (inside the api container): uv run python scripts/export_openapi.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from bsllmner_viewer.api.app import create_app

OPENAPI_FILE = Path(__file__).resolve().parent.parent / "openapi.json"


def main() -> int:
    # The document does not depend on the store, which the app opens only when it starts serving.
    document = create_app(Path("unused.duckdb")).openapi()
    OPENAPI_FILE.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    sys.stdout.write(f"{OPENAPI_FILE}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
