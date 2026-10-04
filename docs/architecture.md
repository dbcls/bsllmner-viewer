# Architecture

bsllmner-viewer has four components:

- build, which reads the inputs and produces a store
- the store, which holds one version of a dataset
- the api, which answers queries with the data of the store
- the frontend, which shows the results in a browser

In the docs, the lowercase words build, store, api, and frontend refer to these components. The uppercase word API refers to the HTTP API that the api component serves to clients.

## Components

```
 manifest ---+
 run files --+--> build --> store file --> api --> frontend
 reference --+
```

| Component | Responsible for | Not responsible for |
|---|---|---|
| build | Validating inputs, reading runs and reference data into the store, deriving the data that queries use, and verifying the resulting store | Serving data |
| store | A single DuckDB file that represents one version of one dataset | Changes after publication: a published store does not change |
| api | Opening the store read-only, parsing and evaluating the condition domain-specific language (DSL), and returning entries, aggregations, and exports | Writing to the store |
| frontend | Letting the user compose conditions, and displaying the results that the api returns | Counting matches, and evaluating conditions |

[build.md](build.md) specifies the input formats and the build operations. [data-model.md](data-model.md) defines the meaning of the stored data. [provenance.md](provenance.md) specifies how build links extracted values to evidence. [api.md](api.md) specifies the external contract of the api.

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | The Python package that contains both build and the api |
| `backend/openapi.json` | The OpenAPI document of the api |
| `backend/src/bsllmner_viewer/dsl/` | The condition DSL: grammar, abstract syntax tree (AST), parser, serializer, validation, and SQL compilation |
| `backend/src/bsllmner_viewer/build/` | The build operations, and the readers of every input format |
| `backend/src/bsllmner_viewer/store/` | The store schema and the dataset version information, which build and the api share |
| `backend/src/bsllmner_viewer/api/` | The FastAPI application: a router for each resource, and the query builders in `api/queries/` |
| `frontend/` | The TypeScript single-page application (SPA) |
| `deploy/` | The compose files and the settings of a deployment ([deployment.md](deployment.md)) |
| `docs/` | The specifications |

One package contains both build and the api, because build writes the store schema and the api reads the store schema. You apply a change of the schema to build and to the api in a single change.

## Invariants

### The UI and the API have the same capabilities

The frontend displays what the api returns, and does not count matches or evaluate conditions. Each count, table, and chart that the UI shows comes from one query to the api, and every query accepts the same condition DSL. Therefore, an API client can reproduce any result of the UI with the same condition ([api.md](api.md#urls)).

The frontend can sort, color, and arrange the results, but every count that the frontend displays comes from the api.

The opposite direction is also true: the api has a condition or a data operation only if the UI also offers the condition or the data operation. A user can set every field of the condition DSL in the condition panel or in a view of the UI. An API client can choose some values that the UI fixes, such as the number of default elements and `facetSelfExclude`. `GET /api/service-info` is for health monitoring, and the UI has no counterpart for it.

If you add a condition or a data operation, then add it to the UI and to the api in the same change. If the UI stops offering a field of the DSL, then remove the field from the api.

### Only the api interprets the condition DSL

The api parses, serializes, and evaluates the condition DSL. The frontend keeps a condition as the string `q` in the URL. The frontend gets the AST, the labels, the selected clauses, and the text of the keyword box from the parse operation of the api. To change a condition, the frontend calls the select operation or the keyword operation of the api ([api.md](api.md#parsing-and-changing-a-condition)), and does not compose a condition string itself.

The frontend sets `q` directly only to one of these values:

- a string that the user typed
- a condition that the api returned
- an empty condition
- one of the example conditions that the top page links to

A URL cannot mean different things in the UI and in the API.

### A published store is never modified

Every build operation writes a new store file. You switch the api to a new file only after the file passes verification. Nobody rewrites a file that the api serves. Therefore, the api returns a consistent dataset version during an update. To revert an update, you switch the api back to the previous file.

Only build writes a store. The api opens a store read-only.

### API types are generated from OpenAPI

The OpenAPI document of the api, which is committed to the repository as `backend/openapi.json`, is the authoritative definition of the types of requests and responses. The frontend generates its API types from `backend/openapi.json`, and the frontend does not use handwritten API types. Tests check that `backend/openapi.json` is the document that the api produces, and that the API types of the frontend are the types generated from `backend/openapi.json`.

## Technology constraints

- The store is a single DuckDB file. In one operation, build writes a whole dataset, and the api serves the dataset read-only. Because each version is one file, you publish a version or return to an earlier version by switching the file, and you need no database server.
- The frontend is a static SPA, and every page uses the same HTML file. The api is a public API without authentication, so the frontend needs no server-side layer between the frontend and the api. [deployment.md](deployment.md#crawlers-and-agents) describes what the HTML file and each page give to the programs that read the HTML file and the pages.
