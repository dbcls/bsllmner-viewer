# Architecture

bsllmner-viewer consists of four components: **build** produces a store, the **store** holds one version of a dataset, the **api** serves queries over the store, and the **frontend** renders the results in a browser.

## Components

```
 manifest ---+
 run files --+--> build --> store file --> api --> frontend
 reference --+
```

| Component | Responsible for | Not responsible for |
|---|---|---|
| build | Validating inputs, ingesting runs and reference data, deriving query-ready data, and verifying the resulting store | Serving data |
| store | A single DuckDB file representing one version of one dataset | Changing after publication |
| api | Opening the store read-only, parsing and evaluating the condition DSL, and returning entries, aggregations, and exports | Writing to the store |
| frontend | Composing conditions and displaying results returned by the api | Counting records or evaluating conditions |

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | Python package containing both build and api |
| `frontend/` | TypeScript single-page application |
| `docs/` | Specifications |

build and api share one package because build writes the store schema and api reads it; a schema change is applied to both sides in a single change.

Input formats and build operations are specified in [build.md](build.md), the meaning of stored data in [data-model.md](data-model.md), and the external contract of the api in [api.md](api.md).

## Invariants

### Everything the UI shows is available from the API

The frontend displays what the api returns and does not count records or evaluate conditions itself. Each UI view corresponds to exactly one api query, and every query accepts the same condition DSL. Any result shown in the UI is therefore reproducible by an API client using the same condition.

The frontend may sort, color, and lay out results, but every count it displays comes from the api.

### Only the api interprets the condition DSL

Parsing, serialization, and evaluation of the condition DSL live in the api. The frontend holds a condition as an AST and uses the api's parse and serialize operations to convert between the AST and the URL string, so a URL cannot mean different things in the UI and in the API.

### A published store is never modified

Every build operation writes a new store file. The api is switched to a new file only after the file passes verification, and a file being served is never rewritten. The api returns a consistent dataset version during updates, and reverting means switching back to the previous file.

build is the only component that writes a store. api opens it read-only.

### API types are generated from OpenAPI

The api's OpenAPI document is the source of truth for request and response types. The frontend generates its API types from it; handwritten types are not used.

## Technology constraints

- **Store as a single DuckDB file.** Datasets are built in bulk and served read-only. One file per version makes publication and rollback a file switch and requires no database server.
- **Frontend as a static single-page application.** The api is a public API without authentication, so no server-side layer is needed between the frontend and the api.
