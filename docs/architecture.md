# Architecture

bsllmner-viewer consists of four components: build produces a store, the store holds one version of a dataset, the api serves queries over the store, and the frontend renders the results in a browser.

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
| frontend | Composing conditions and displaying results returned by the api | Counting matches or evaluating conditions |

## Repository layout

| Path | Contents |
|---|---|
| `backend/` | Python package containing both build and api, and the OpenAPI document of the api (`openapi.json`) |
| `frontend/` | TypeScript single-page application |
| `docs/` | Specifications |

build and api share one package because build writes the store schema and api reads it; a schema change is applied to both sides in a single change.

Input formats and build operations are specified in [build.md](build.md), the meaning of stored data in [data-model.md](data-model.md), how build links extracted values to evidence in [provenance.md](provenance.md), and the external contract of the api in [api.md](api.md).

## Invariants

### The UI and the API have the same capabilities

The frontend displays what the api returns and does not count matches or evaluate conditions itself. Every count, table, and chart that the UI shows comes from one api query, and every query accepts the same condition DSL. Any result shown in the UI is therefore reproducible by an API client using the same condition.

The frontend may sort, color, and arrange results, but every count that the frontend displays comes from the api.

The reverse also holds: the api has no condition and no data operation that the UI does not offer. Every field of the condition DSL can be set from the condition panel or from a view. A client of the api can choose some values that the UI fixes, such as the number of default elements and `facetSelfExclude`. `GET /api/service-info` is for health monitoring and has no counterpart in the UI. A condition or a data operation is added to both sides in the same change, and a DSL field that the UI stops offering is removed from the api.

### Only the api interprets the condition DSL

Parsing, serialization, and evaluation of the condition DSL live in the api. The frontend holds a condition as the URL string `q`. The frontend reads the AST, the labels, the selected clauses, and the text of the keyword box from the api's parse operation. The frontend changes a condition through the api's select and keyword operations, and does not compose a condition string itself. The frontend sets `q` directly only to a string that the user typed, to a condition that the api returned, to an empty condition, or to one of the example conditions that the top page links to. A URL cannot mean different things in the UI and in the API.

### A published store is never modified

Every build operation writes a new store file. The api is switched to a new file only after the file passes verification, and a file being served is never rewritten. The api returns a consistent dataset version during updates, and reverting means switching back to the previous file.

build is the only component that writes a store. api opens it read-only.

### API types are generated from OpenAPI

The api's OpenAPI document is the source of truth for request and response types. The document is committed as `backend/openapi.json`, and the frontend generates its API types from this file. Handwritten types are not used. Tests check that the file is the document of the api and that the types are the ones generated from the file.

## Technology constraints

- Store as a single DuckDB file. Datasets are built in bulk and served read-only. One file per version makes publication and rollback a file switch and requires no database server.
- Frontend as a static single-page application. The api is a public API without authentication, so no server-side layer is needed between the frontend and the api.
- One HTML file for every page. The head of the HTML file names and describes the site, for programs that read the HTML without running JavaScript, such as the programs that make the previews of shared links. In the browser, each page sets its own title. A page also sets a description and a canonical address if it has them, and `noindex` if it is an error page or the page of an accession that is not in the dataset or that could not be loaded. A link to an address that robots.txt disallows has `rel="nofollow"` (`crawlRel` in the frontend). If you change the addresses that robots.txt disallows, then change `crawlRel` in the same way.
