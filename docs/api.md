# API

This document specifies the semantics of the api that its OpenAPI document cannot express: the condition DSL, aggregation semantics, the correspondence between queries and UI views, the relationship to URLs, and the compatibility policy. Endpoints, parameters, and response types are defined by the OpenAPI document.

The api is a public API without authentication. The frontend and other clients use the same API.

## Condition DSL

A condition is a single string, `q`. Queries for records, aggregations, and exports all accept the same `q`.

### Grammar

The grammar is the Lucene subset used by the DDBJ Search API search DSL (the `/db-portal/*` endpoints). A condition string parses to an AST of the same shape in both.

- `field:value`, `field:"phrase"`, and `field:[a TO b]`
- `AND`, `OR`, and `NOT` (upper case), and grouping with `( )`
- The JSON representation of the AST has the same shape, with node types discriminated by `op`.

Compatibility covers the grammar and the AST shape. The set of fields and their evaluation are specific to this API. Terms without a field (free-text search) are rejected with an error.

### Fields

| Kind | Example | Matches records where |
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
- Statuses, status groups, and the evaluation of clauses against records are defined in [data-model.md](data-model.md).
- The implementation is the source of truth for the set of available fields.

## Aggregations

An aggregation counts matching records per element along one or two **dimensions**. A dimension is a DSL field, such as `disease`, `disease_status`, `library_strategy`, `date_created`, or `bioproject`. Every element carries a clause on each dimension of the aggregation that represents it, for example `disease:"MONDO:0007254"` for a bar of a distribution, or one clause per axis for a cell of a cross-tabulation.

### Self-exclusion

By default, an aggregation is computed without the conditions on its own dimensions. The population of the aggregation is `q` with every top-level conjunct removed whose clauses are all on the aggregation's dimensions. The remaining conditions apply as usual.

The top-level conjuncts are the operands of the outermost `AND` after nested `AND` groups are merged. For example, `a AND (b AND c)` has three top-level conjuncts.

Self-exclusion keeps every element of a dimension visible while one of its elements is selected, so that the selection can be compared with the alternatives. Drilling down within a selected term is done by expanding the term into its child terms.

A request parameter disables self-exclusion, in which case the population of the aggregation is `q` itself. The record list is always computed from `q` itself.

A distribution on an annotation term dimension also returns the status composition of the field. The status composition is an aggregation on the status dimension of the same field. Its population excludes the conjuncts on the term dimension and the conjuncts on the status dimension. A condition on a term of the field therefore does not reduce the composition to the mapped statuses.

### Default elements

If a request does not name the elements of a dimension, then the api chooses the elements.

- For an annotation term dimension, the api chooses the terms that are assigned directly to the most BioSamples in the population of the aggregation. The count of a term includes the records of its descendants, but the choice does not. A term that is only an ancestor of the assigned terms, such as the root of an ontology, is therefore not chosen.
- The api adds the elements that `q` names in a top-level clause, or in a top-level disjunction of clauses, on the dimension without `NOT`. A selected element is therefore present even if it is not one of the most frequent elements.
- The api returns term, assay, and organism elements in descending order of their counts.

### Trend

A trend counts the records of the condition for each creation year of the BioSample. The population of these counts is `q` without the conjuncts on `date_created`.

If a request names a dimension, then the trend also counts the records of each element of the dimension for each year. The population of these counts also excludes the conjuncts on that dimension.

### Expected counts in cross-tabulations

For each cell of a cross-tabulation, the api returns the expected count and the adjusted standardized residual of the cell under independence of the two dimensions, in the selected counting unit. With `N` the count of the aggregation population, `R` the count of its row, `C` the count of its column, and `O` the count of the cell:

- expected count `E = R × C / N`
- adjusted standardized residual `r = (O − E) / sqrt(E × (1 − R / N) × (1 − C / N))`, or null when the denominator is zero

Row and column counts are counts of matching records, not sums of cell counts.

A cell with `E ≥ 5` is classified as follows. Cells with `E < 5` are not classified.

| Class | Condition |
|---|---|
| Gap | `O = 0` |
| Under-represented | `O > 0` and `r ≤ −2` |
| Over-represented | `r ≥ 2` |

The thresholds are fixed. Rows and columns overlap and BioProject counts are distinct counts, so `E` and `r` describe how far a cell departs from independence rather than constitute a statistical test.

### Invariant

For every element of an aggregation, the element's count equals the count of records matching `q'` combined with the element's clauses by `AND`, in the same counting unit, where `q'` is the population of the aggregation.

### From elements to conditions

An element with one clause is a bar of a distribution or a point of the trend of the condition. Selecting the element in the UI toggles the clause in `q`:

- If `q` has a top-level conjunct that is a clause, or a disjunction of clauses, on the same field without `NOT`, then the new clause is joined to that conjunct with `OR`.
- Otherwise, the new clause is added as a new top-level conjunct with `AND`.
- If the clause is already in `q`, then selecting the element removes the clause, and removes a conjunct that becomes empty.

For example, selecting `disease:A`, then `library_strategy:ATAC-seq`, then `disease:B` produces `(disease:A OR disease:B) AND library_strategy:ATAC-seq`.

An element with two clauses is a cell of a cross-tabulation or a point of the trend of an element. Selecting the element in the UI narrows the condition to the element. The new condition is the population of the aggregation combined by `AND` with both clauses. The number of records that match the new condition equals the count of the element.

For example, with `q` equal to `library_strategy:ChIP-Seq`, selecting the cell of `cell_line:A` and `library_strategy:RNA-Seq` in a cross-tabulation of the two fields produces `cell_line:A AND library_strategy:RNA-Seq`.

The api performs both operations on behalf of clients, so that the UI and other clients derive the same condition from the same selection.

## Queries and UI views

Each UI view (record list, distribution, cross-tabulation, trend, project statistics) and the entry detail corresponds to one API query. Exports are generated from the same `q`. Calling the API with the `q` and view parameters of a UI state returns the result shown in that state.

## URLs

A UI state is represented only by `q` and view parameters (record unit, counting unit, cross-tabulation axes, self-exclusion, and similar), and all of them are part of the URL. The same URL returns the same result against the same store version.

The `q` in a URL is the same string as the `q` of the API.

## Common response conventions

- Every response includes the identifier of the dataset version defined in [build.md](build.md) (`dataset_version`: name, creation time, model, and a digest of the complete version information); the dataset endpoint returns the complete version information. Results recorded from the API should keep the identifier, since counts change with every build.
- Errors are returned as RFC 7807 Problem Details (`application/problem+json`). Errors of the condition DSL use the same `type` slugs as the DDBJ Search API where the same error exists.

## Compatibility

- The version of the OpenAPI document identifies the version of the contract.
- Adding fields, parameters, or response properties is a compatible change. Clients ignore properties they do not know.
- Removing or renaming anything, or changing its meaning, is an incompatible change and increments the major version of the OpenAPI document.
