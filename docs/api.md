# API

This document specifies the semantics of the api that its OpenAPI document cannot express: the conventions shared with the DDBJ Search API, the condition DSL, entries, aggregation semantics, the correspondence between queries and UI views, the relationship to URLs, and the compatibility policy. Endpoints, parameters, and response types are defined by the OpenAPI document.

The api is a public API without authentication. The frontend and other clients use the same API.

- Swagger UI: `/api`
- ReDoc: `/api/redoc`
- OpenAPI document: `/api/openapi.json`

## Conventions

The api follows the conventions of the [DDBJ Search API](https://ddbj.nig.ac.jp/search/api/docs), so that a client of one API can use the other in the same way.

- Every path starts with `/api`. Paths have no trailing slash.
- JSON property names and query parameter names are camelCase, for example `perPage` and `datasetVersion`. Field names of the condition DSL are snake_case, for example `organism_id`, as in the DSL of the DDBJ Search API.
- Entry types use the names of the DDBJ Search API: `biosample`, `sra-experiment`, `sra-run`, and `bioproject`.
- An organism is an object with `identifier` (the NCBI Taxonomy ID as a string) and `name`.
- A paginated list returns `pagination` (`page`, `perPage`, `total`, and `hasNext`) and `items`. `page` starts at 1, and `perPage` is between 1 and 100.
- Every response has an `X-Request-ID` header. If the request has an `X-Request-ID` header, then the response repeats its value. Otherwise, the api generates a UUID.
- Cross-origin requests are allowed from every origin, with every method and header.
- Every JSON response includes `datasetVersion`, the identifier of the dataset version defined in [build.md](build.md): the name, the creation time, the model, and a digest of the complete version information. `GET /api/dataset` returns the complete version information. Results recorded from the API should keep the identifier, because counts change with every build.

### Errors

Errors are RFC 7807 Problem Details (`application/problem+json`) with `type`, `title`, `status`, `detail`, `instance`, `timestamp` (ISO 8601, UTC), and `requestId` (the value of the `X-Request-ID` header).

- `type` is `about:blank` for errors that the HTTP status describes, such as an unknown accession (404) or an invalid query parameter (422). `title` is the HTTP status phrase.
- `type` is `https://ddbj.nig.ac.jp/problems/<slug>` for errors specific to the api. Errors of the condition DSL use the slugs of the DDBJ Search API where the same error exists, for example `unknown-field` and `unexpected-token`. A request body that is not a valid AST is rejected with status 400 and slug `invalid-ast`.

### Service information

`GET /api/service-info` returns the name, the version, the description, and the state of the store (`ok` or `unavailable`). It returns status 200 even when the store is unavailable, and it is the endpoint for health monitoring.

## Condition DSL

A condition is a single string, `q`. Queries for entries, aggregations, and exports all accept the same `q`. If `q` is omitted or empty, then the condition matches the whole population.

### Grammar

The grammar is the Lucene subset used by the DDBJ Search API search DSL (the `/db-portal/*` endpoints). A condition string parses to an AST of the same shape in both.

- `field:value`, `field:"phrase"`, and `field:[a TO b]`
- `AND`, `OR`, and `NOT` (upper case), and grouping with `( )`
- The JSON representation of the AST has the same shape, with node types discriminated by `op`.

`GET /api/dsl/parse` and `POST /api/dsl/serialize` convert between the string and the AST. Their requests and responses have the shape of `/db-portal/parse` (`{ast}`) and `/db-portal/serialize` (`{dsl}`) of the DDBJ Search API, with the display labels of the term IDs and organism IDs in the condition added.

Compatibility covers the grammar and the AST shape. The set of fields and their evaluation are specific to this API. Terms without a field (free-text search) are rejected with an error.

### Fields

| Kind | Example | Matches where |
|---|---|---|
| Annotation term | `disease:"MONDO:0007254"` | the field has the given term or one of its descendants |
| Annotation extracted value | `disease_value:breast` | an extracted value of the field contains the string, case-insensitively |
| Annotation status | `disease_status:unmapped` | the field has the given status, or a status under the given group |
| Assay | `library_strategy:ATAC-seq` | the experiment has the given `library_strategy` |
| Organism | `organism_id:9606` | the BioSample's organism has the given NCBI Taxonomy ID |
| Creation date | `date_created:[2015-01-01 TO 2020-12-31]` | the BioSample's creation date is in the range |
| BioProject | `bioproject:PRJNA123456` | the BioSample belongs to the given BioProject |
| Accession | `identifier:SAMN00000001` | the BioSample or the experiment has the given accession |
| Title | `title:tumor` | the BioSample's title contains the string |

- Annotation field names are the field names of the select configuration. `_value` and `_status` are suffixes appended to a field name.
- Other fields use the DDBJ Search API field name when the DDBJ Search API has a field for the same concept.
- Statuses, status groups, and the evaluation of clauses against BioSamples and experiments are defined in [data-model.md](data-model.md).
- The implementation is the source of truth for the set of available fields.

## Entries

An entry is a BioSample or an SRA experiment. `GET /api/entries/biosample` lists the BioSamples that match `q`, and `GET /api/entries/sra-experiment` lists the experiments that match `q`, in the sense of the counting units in [data-model.md](data-model.md). Each item has the accession of the entry as `identifier`, its type as `type`, and the BioSample's metadata and annotations. An entry list is always computed from `q` itself.

`GET /api/entries/biosample/{accession}` returns one BioSample with its original attributes, its annotations with evidence, its experiments, and its BioProjects. The BioSample does not have to be in the population; its experiments show which of them are.

The exports return every matching entry of a type as TSV or as newline-delimited JSON (`application/x-ndjson`), and every matching accession of a type as plain text with one accession per line. Accession lists also exist for `sra-run` and `bioproject`.

## Aggregations

An aggregation counts the matches of `q` per element along one or two **dimensions**, in a counting unit. A dimension is a DSL field, such as `disease`, `disease_status`, `library_strategy`, `date_created`, or `bioproject`. Every element carries a clause on each dimension of the aggregation that represents it, for example `disease:"MONDO:0007254"` for a bar of a distribution, or one clause per axis for a cell of a cross-tabulation.

The bucket of an element has `value`, `label`, and `count`, as a facet bucket of the DDBJ Search API, and the element's `clauses` in addition.

### Self-exclusion

By default, the population of an aggregation is `q`, as in the DDBJ Search API.

With `facetSelfExclude=true`, an aggregation is computed without the conditions on its own dimensions. The population of the aggregation is `q` with every top-level conjunct removed whose clauses are all on the aggregation's dimensions. The remaining conditions apply as usual. Each response returns the population that it was computed from as `populationQ`.

The top-level conjuncts are the operands of the outermost `AND` after nested `AND` groups are merged. For example, `a AND (b AND c)` has three top-level conjuncts.

Self-exclusion keeps every element of a dimension visible while one of its elements is selected, so that the selection can be compared with the alternatives. The UI computes every aggregation with self-exclusion unless the user turns it off. Drilling down within a selected term is done by expanding the term into its child terms.

A distribution on an annotation term dimension also returns the status composition of the field. The status composition is an aggregation on the status dimension of the same field. With self-exclusion, its population excludes the conjuncts on the term dimension and the conjuncts on the status dimension. A condition on a term of the field therefore does not reduce the composition to the mapped statuses.

### Default elements

If a request does not name the elements of a dimension, then the api chooses the elements.

- For an annotation term dimension, the api chooses the terms that are assigned directly to the most BioSamples in the population of the aggregation. The count of a term includes its descendants, but the choice does not. A term that is only an ancestor of the assigned terms, such as the root of an ontology, is therefore not chosen.
- The api adds the elements that `q` names in a top-level clause, or in a top-level disjunction of clauses, on the dimension without `NOT`. A selected element is therefore present even if it is not one of the most frequent elements.
- The api returns term, assay, and organism elements in descending order of their counts.

### Trend

A trend counts the condition for each creation year of the BioSample. With self-exclusion, the population of these counts is `q` without the conjuncts on `date_created`.

If a request names a dimension, then the trend also counts each element of the dimension for each year. With self-exclusion, the population of these counts also excludes the conjuncts on that dimension.

### Expected counts in cross-tabulations

For each cell of a cross-tabulation, the api returns the expected count and the adjusted standardized residual of the cell under independence of the two dimensions, in the selected counting unit. With `N` the count of the aggregation population, `R` the count of its row, `C` the count of its column, and `O` the count of the cell:

- expected count `E = R × C / N`
- adjusted standardized residual `r = (O − E) / sqrt(E × (1 − R / N) × (1 − C / N))`, or null when the denominator is zero

Row and column counts are counts of the matches of the row or the column, not sums of cell counts.

A cell with `E ≥ 5` is classified as follows. Cells with `E < 5` are not classified.

| Class | Condition |
|---|---|
| Gap | `O = 0` |
| Under-represented | `O > 0` and `r ≤ −2` |
| Over-represented | `r ≥ 2` |

The thresholds are fixed. Rows and columns overlap and BioProject counts are distinct counts, so `E` and `r` describe how far a cell departs from independence rather than constitute a statistical test.

### Invariant

For every element of an aggregation, the element's count equals the count of `q'` combined with the element's clauses by `AND`, in the same counting unit, where `q'` is the population of the aggregation.

### From elements to conditions

An element with one clause is a bar of a distribution or a point of the trend of the condition. Selecting the element in the UI toggles the clause in `q`:

- If `q` has a top-level conjunct that is a clause, or a disjunction of clauses, on the same field without `NOT`, then the new clause is joined to that conjunct with `OR`.
- Otherwise, the new clause is added as a new top-level conjunct with `AND`.
- If the clause is already in `q`, then selecting the element removes the clause, and removes a conjunct that becomes empty.

For example, selecting `disease:A`, then `library_strategy:ATAC-seq`, then `disease:B` produces `(disease:A OR disease:B) AND library_strategy:ATAC-seq`.

An element with two clauses is a cell of a cross-tabulation or a point of the trend of an element. Selecting the element in the UI narrows the condition to the element. The new condition is the population of the aggregation combined by `AND` with both clauses. The count of the new condition equals the count of the element, in the same counting unit.

For example, with `q` equal to `library_strategy:ChIP-Seq`, selecting the cell of `cell_line:A` and `library_strategy:RNA-Seq` in a cross-tabulation of the two fields produces `cell_line:A AND library_strategy:RNA-Seq`.

`POST /api/dsl/select` performs both operations on behalf of clients, so that the UI and other clients derive the same condition from the same selection.

## Queries and UI views

Each UI view (entry list, distribution, cross-tabulation, trend, project statistics) and the BioSample page correspond to one API query. Exports are generated from the same `q`. Calling the API with the `q` and view parameters of a UI state returns the result shown in that state.

## URLs

The UI has three pages: `/` is the start page, `/entries` is the page that shows the entries and aggregations of a condition, and `/entries/{accession}` is the page of one BioSample.

The state of `/entries` is represented only by `q` and view parameters (entry type, counting unit, cross-tabulation axes, self-exclusion, and similar), and all of them are part of the URL. The same URL returns the same result against the same store version.

The `q` in a URL is the same string as the `q` of the API.

## Compatibility

- The version of the OpenAPI document identifies the version of the contract.
- Before version 1.0.0, any version may change the contract incompatibly.
- From version 1.0.0, adding endpoints, parameters, or response properties is a compatible change. Clients ignore properties that they do not know. Removing or renaming anything, or changing its meaning, is an incompatible change and increments the major version.
