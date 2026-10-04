# Development

This document describes how to run, test, and check the code. [testing.md](testing.md) gives the policy of the tests, and [operations.md](operations.md) gives the procedures to build and publish a store.

## Environment

Everything runs in two containers that `compose.yml` defines: `api` (Python, the backend package) and `frontend` (Node, the single-page application). You install nothing on the host except Docker (or Podman) with Compose.

```
cp .env.example .env
docker compose run --rm --no-deps api uv run python scripts/synthetic_store.py /data/store/synthetic.duckdb
docker compose up
```

- `.env` sets two variables. `BSLLMNER_VIEWER_DATA_DIR` is the directory that compose mounts at `/data` in the api container, and holds the manifests, the inputs, the reference data, and the store files. `BSLLMNER_VIEWER_STORE` is the store file that the api opens. In `.env.example`, `BSLLMNER_VIEWER_STORE` is the synthetic store, which the second command above builds from generated data in a few seconds.
- The api serves `http://localhost:8000`. Swagger UI is at `/api`, and the OpenAPI document is at `/api/openapi.json`.
- The frontend dev server serves `http://localhost:5173`, and calls the api through the Vite proxy. The dev server also serves `/llms-full.txt`, which the dev server makes from `docs/` for each request.
- Compose also mounts these directories:
  - `docs/` read-only at `/docs` in the `api` container and the `frontend` container, to make `/llms-full.txt` and for the tests that check the docs
  - `frontend/public/` at `/frontend/public` in the `api` container, for the tests that compare `llms.txt` with the OpenAPI document
  - `backend/` read-only at `/backend` in the `frontend` container, so that the frontend can generate its API types from `backend/openapi.json`
- To serve a store that you built from real runs ([operations.md](operations.md#building-a-store)), set `BSLLMNER_VIEWER_STORE` to the path of the store file, and recreate the api container with `docker compose up -d --force-recreate api`.
- After a file changes on the bind mount, the dev server sometimes serves an empty module, and the browser reports a missing export. To fix this, run `docker compose restart frontend`.

## Backend

These commands run inside the `api` container:

```
docker compose run --rm --no-deps api uv run ruff check .
docker compose run --rm --no-deps api uv run ruff format --check .
docker compose run --rm --no-deps api uv run mypy
docker compose run --rm --no-deps api uv run pytest
docker compose run --rm --no-deps -T api uv run python scripts/export_openapi.py   # writes openapi.json
```

- `backend/openapi.json` is the OpenAPI document of the api, and is committed to the repository. `scripts/export_openapi.py` writes `backend/openapi.json` without opening a store. After you change the api, run `scripts/export_openapi.py` again. A test fails if `backend/openapi.json` differs from the document that the api produces.
- The backend tests are in `backend/tests/unit/` and `backend/tests/pbt/` (property-based tests with hypothesis). `backend/tests/synthetic.py` generates a complete dataset in the input formats. The session fixtures in `backend/tests/conftest.py` build a store from this dataset once, and share the store among the tests.

## Frontend

These commands run inside the `frontend` container:

```
docker compose run --rm --no-deps frontend npm run lint
docker compose run --rm --no-deps frontend npm run typecheck
docker compose run --rm --no-deps frontend npm test
docker compose run --rm --no-deps frontend npm run gen:api-types
```

- `npm run gen:api-types` generates the API types from `backend/openapi.json` into `frontend/app/lib/api/openapi-types.ts`, and the types are committed to the repository. After you write `backend/openapi.json` again, generate the types again. A test fails if the committed types differ from the types that `backend/openapi.json` gives.
- The unit tests and the property-based tests (`frontend/tests/unit/` and `frontend/tests/pbt/`, with vitest and fast-check) need neither the api nor the dev server.

## End-to-end tests

The end-to-end tests (`frontend/tests/e2e/`) use Playwright to operate a deployed site that has its real dataset. [testing.md](testing.md#end-to-end-tests) describes when to run the tests.

```
docker compose run --rm --no-deps -T \
  -e BSLLMNER_VIEWER_E2E_BASE_URL=https://example.invalid \
  -e BSLLMNER_VIEWER_E2E_NOINDEX=true -e BSLLMNER_VIEWER_E2E_COMMIT=<commit> \
  frontend npm run test:e2e
```

- `BSLLMNER_VIEWER_E2E_BASE_URL` is the address of the deployment. If the variable is not set, then the tests stop before the first scenario.
- `BSLLMNER_VIEWER_E2E_NOINDEX` and `BSLLMNER_VIEWER_E2E_COMMIT` give the intended state of the deployment: the intended value of `BSLLMNER_VIEWER_NOINDEX` of the deployment, and the commit that should be deployed. If one of these variables is not set, then the scenarios that check it are skipped.
- If `BSLLMNER_VIEWER_E2E_NOINDEX` is not set, then the tests do not treat the address as a deployment, and skip the scenarios that check the web server in front of the api, because the dev server has no such web server.
- The frontend image contains Chromium, so no browser is installed on the host.
- The tests write the report to `frontend/playwright-report/`, and write the traces of failed tests to `frontend/test-results/`.

## Conventions

- Python: use ruff, and mypy in strict mode. Write data models with Pydantic v2, and write logic as functions.
- TypeScript: use ESLint with the `@stylistic` rules, and do not add a separate formatter. Take colors and sizes from the design tokens in `frontend/app/styles/tailwind.css`. Lint rejects raw hex colors in `frontend/app/features/`, `frontend/app/routes/`, `frontend/app/ui/`, and `frontend/app/shell/`. Lint also rejects Tailwind arbitrary values, such as `w-[150px]`, in `frontend/app/features/` and `frontend/app/routes/`.
- Test names: use `test_<subject>_<condition>_<expectation>` in Python, and `describe("<subject>") > it("<condition and expectation>")` in TypeScript. Use `test.describe` and `test` of Playwright in the same way as `describe` and `it`.
