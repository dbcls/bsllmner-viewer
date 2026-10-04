# Development

This document describes how to run, test, and check the code. The build and publication procedures are in [operations.md](operations.md).

## Environment

Everything runs in containers defined by `compose.yml`: `api` (Python, the backend package) and `frontend` (Node, the single-page application). Nothing is installed on the host beyond Docker (or Podman) with Compose.

```
cp .env.example .env
docker compose run --rm --no-deps api uv run python scripts/synthetic_store.py /data/store/synthetic.duckdb
docker compose up
```

- `.env` sets `BSLLMNER_VIEWER_DATA_DIR`, the directory mounted at `/data` in the api container (manifests, inputs, reference data, and store files), and `BSLLMNER_VIEWER_STORE`, the store file the api opens. `.env.example` names the synthetic store, which the second command builds from generated data in a few seconds.
- The api serves `http://localhost:8000`. Swagger UI is at `/api`, and the OpenAPI document is at `/api/openapi.json`.
- The frontend dev server serves `http://localhost:5173` and calls the api through the Vite proxy. The dev server also serves `/llms-full.txt`, which the dev server makes from `docs/` on each request. Compose mounts `docs/` read-only at `/docs` in the `api` and `frontend` containers for this, and for the tests that check the docs. The `api` container also mounts `frontend/public/` at `/frontend/public`, for the tests that check `llms.txt` against the OpenAPI document. The `frontend` container mounts `backend/` read-only at `/backend`, so that the frontend generates its API types from `backend/openapi.json`.
- To serve a store built from real runs (see [operations.md](operations.md)), set `BSLLMNER_VIEWER_STORE` to the store file and recreate the api container: `docker compose up -d --force-recreate api`.
- The dev server occasionally serves an empty module after a file changes on the bind mount (the browser then reports a missing export). `docker compose restart frontend` clears it.

## Backend

Commands run inside the `api` container:

```
docker compose run --rm --no-deps api uv run ruff check .
docker compose run --rm --no-deps api uv run ruff format --check .
docker compose run --rm --no-deps api uv run mypy
docker compose run --rm --no-deps api uv run pytest
docker compose run --rm --no-deps -T api uv run python scripts/export_openapi.py   # writes openapi.json
```

- `src/bsllmner_viewer/dsl/` holds the condition DSL (grammar, AST, parser, serializer, validation, SQL compilation).
- `src/bsllmner_viewer/build/` holds the build operations and the readers of every input format; `src/bsllmner_viewer/store/` the schema and version information shared with the api.
- `src/bsllmner_viewer/api/` holds the FastAPI application: routers per resource and query builders in `api/queries/`.
- `openapi.json` is the OpenAPI document of the api, and it is committed. `scripts/export_openapi.py` writes it without opening a store. After you change the api, write the file again. A test fails if the file is not the document of the api.
- Tests are `tests/unit/` and `tests/pbt/` (property-based, hypothesis). `tests/synthetic.py` generates a complete dataset in the input formats; the session fixtures in `tests/conftest.py` build a store from it once and share it.

## Frontend

Commands run inside the `frontend` container:

```
docker compose run --rm --no-deps frontend npm run lint
docker compose run --rm --no-deps frontend npm run typecheck
docker compose run --rm --no-deps frontend npm test
docker compose run --rm --no-deps frontend npm run gen:api-types
```

- API types are generated from `backend/openapi.json` into `app/lib/api/openapi-types.ts`, and they are committed. After you write `backend/openapi.json` again, generate the types again. A test fails if the types are not the ones generated from the file.
- Unit and property-based tests (`tests/unit/`, `tests/pbt/`; vitest and fast-check) need neither the api nor the dev server.

### End-to-end tests

The end-to-end tests (`tests/e2e/`, Playwright) drive a deployed site with its real dataset. The policy is in [testing.md](testing.md).

```
docker compose run --rm --no-deps -T \
  -e BSLLMNER_VIEWER_E2E_BASE_URL=https://example.invalid \
  -e BSLLMNER_VIEWER_E2E_NOINDEX=true -e BSLLMNER_VIEWER_E2E_COMMIT=<commit> \
  frontend npm run test:e2e
```

- `BSLLMNER_VIEWER_E2E_BASE_URL` is the address of the deployment. The tests stop before the first scenario if it is not set.
- `BSLLMNER_VIEWER_E2E_NOINDEX` (the deployment's `BSLLMNER_VIEWER_NOINDEX`) and `BSLLMNER_VIEWER_E2E_COMMIT` (the deployed commit) are what the deployment is meant to be. The scenarios that check them skip if they are not set. The scenarios of the web server in front of the api also skip if `BSLLMNER_VIEWER_E2E_NOINDEX` is not set, because the address is then not taken as a deployment, and the dev server has no such web server.
- The frontend image contains Chromium, so no browser is installed on the host.
- The report is written to `frontend/playwright-report/` and the traces of failed tests to `frontend/test-results/`.

## Conventions

- Python: ruff and mypy in strict mode; data models are Pydantic v2; logic is written as functions.
- TypeScript: ESLint with `@stylistic` rules; no separate formatter. Colors and sizes come from the design tokens in `app/styles/tailwind.css`. Lint rejects raw hex colors in `app/features/`, `app/routes/`, `app/ui/`, and `app/shell/`, and Tailwind arbitrary values, such as `w-[150px]`, in `app/features/` and `app/routes/`.
- Test names follow `test_<subject>_<condition>_<expectation>` in Python and `describe("<subject>") > it("<condition and expectation>")` in TypeScript; Playwright tests use `test.describe` and `test` the same way.
