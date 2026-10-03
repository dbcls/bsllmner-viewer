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
- A `sort` parameter has the form `{field}:{direction}`, where `direction` is `asc` or `desc`.
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
- keywords without a field: `hypoxia organoid` and `"breast cancer"`
- phrases in double or single quotes: `"breast cancer"` and `'breast cancer'`. Inside a phrase, a backslash makes the next character part of the phrase.
- `AND`, `OR`, and `NOT` (upper case), and grouping with `( )`
- The JSON representation of the AST has the same shape, with node types discriminated by `op`.

`GET /api/dsl/parse` and `POST /api/dsl/serialize` convert between the string and the AST. Their requests and responses have the shape of `/db-portal/parse` (`{ast}`) and `/db-portal/serialize` (`{dsl}`) of the DDBJ Search API, with the display labels of the term IDs and organism IDs in the condition added.

Compatibility covers the grammar and the AST shape. The set of fields and the evaluation of fields and keywords are specific to this API.

### Fields

| Kind | Example | Matches where |
|---|---|---|
| Annotation term | `disease:"MONDO:0007254"` | the field has the given term or one of its descendants |
| Annotation status | `disease_status:unmapped` | the field has the given status, or a status under the given group |
| Assay | `library_strategy:ATAC-seq` | the experiment has the given `library_strategy` |
| Organism | `organism_id:9606` | the BioSample's organism has the given NCBI Taxonomy ID |
| Publication date | `date_published:[2015-01-01 TO 2020-12-31]` | the BioSample's publication date is in the range |
| BioProject | `bioproject:PRJNA123456` | the BioSample belongs to the given BioProject |

- Annotation field names are the field names of the select configuration. `_status` is a suffix appended to a field name.
- Other fields use the DDBJ Search API field name when the DDBJ Search API has a field for the same concept.
- Statuses, status groups, and the evaluation of clauses against BioSamples and experiments are defined in [data-model.md](data-model.md).
- The implementation is the source of truth for the set of available fields.

### Keywords

A term without a field is a keyword, such as `hypoxia organoid` or `"breast cancer"`. A keyword matches an entry whose searchable text contains it. The searchable text of a BioSample is defined in [data-model.md](data-model.md#condition-evaluation). Matching follows the free-text search of the DDBJ Search API wherever the two can be compared.

- Letters are compared case-insensitively. Every character other than a letter or a digit separates words.
- Every word of a keyword must occur in the text, in any order and in any part of the text. `breast cancer` matches a BioSample whose title says "breast" and whose disease is "cancer".
- A word matches whole words, so `cell` does not match `cellulose`. The last word of a keyword also matches the start of a word, so `organoid` matches `organoids` and `H3K27` matches `H3K27ac`. A last word of one character matches whole words only.
- A word that contains symbols, such as `IL-4` or `CD4+`, matches its parts in sequence (`IL 4`) and its parts written together (`IL4`). A word of the text that joins its parts with symbols, such as `MCF-7`, also matches the parts written together, so `MCF7` matches `MCF-7`.
- A quoted keyword is a phrase. Its words must occur in sequence within one value, such as one attribute value or the title.
- Words with symbols and phrases do not match the start of a word.
- A word in the form of an accession matches the entry that has that accession, case-insensitively. The accession can be that of a BioSample (`SAMN`, `SAMD`, `SAMEA`), an SRA Experiment (`SRX`, `DRX`, `ERX`), an SRA Run (`SRR`, `DRR`, `ERR`), or a BioProject (`PRJNA`, `PRJDB`, `PRJEB`). An SRA Experiment or SRA Run accession matches only the entry of its experiment.
- Wildcards are rejected with an error, as in the DDBJ Search API. A keyword without a letter or a digit is rejected with an error.

Unlike the DDBJ Search API, a keyword may appear anywhere in a condition, including under `OR` and `NOT`, and a condition may have several keywords.

## Entries

An entry is a BioSample. `GET /api/entries/biosample` lists the BioSamples that match `q`, in the sense of the BioSample counting unit in [data-model.md](data-model.md). Each item has the accession of the BioSample as `identifier`, `biosample` as `type`, the BioSample's metadata and annotations, and the experiments of the BioSample that match `q` as `experiments`. The annotations belong to the BioSample, and a BioSample can have several experiments, so an experiment is listed in the item of its BioSample and is not an entry of its own. An entry list is always computed from `q` itself.

`GET /api/entries/biosample/{accession}` returns one BioSample with its original metadata ([data-model.md](data-model.md#entities)), its annotations with evidence, its experiments, and its BioProjects. The BioSample does not have to be in the population; its experiments show which of them are. Each annotation with a term also has the clause on its field and term, so that a client can make a condition from it.

The original metadata is a list of items. Each item has its kind (`description`, `record`, or `attribute`), a name to show, and a value. The items come in this order of their kinds, so that the attributes come last and the items that describe the BioSample as a whole come first. Evidence identifies an item by its position in the list (`metadataIndex`). `inName` is true if the evidence is in the name of an attribute, and false if it is in the value of the item. `start` and `end` are character positions in that name or value. `strategy` is the matching strategy that found the evidence ([provenance.md](provenance.md#matching-strategies)).

- The description is always returned: the title, the description paragraphs, the sample name, and the synonyms, named `Title`, `Description`, `Sample name`, and `Synonym`.
- An item of the record is returned only when evidence of the BioSample points to it. It is named by a short name for its path in the input entry, such as `Owner` for `Owner.Name` and `Status` for `Status.when`. A path without a short name is its own name.
- An attribute is named by its attribute name. The attributes leave out each attribute whose name bsllmner-mk2 lists in its `filter_keys.json` ([build.md](build.md#runs)) and that no evidence of the BioSample points to. Such an attribute records how the BioSample was submitted and archived, so it is shown only when an annotation of the BioSample was derived from it. For example, `INSDC center name` is left out, but a `Submitter Id` of `E-MTAB-13151:ChIP_ETO2_DMSO_rep1` stays when the ChIP antigen ETO2 was found in it. Keywords still match the values of the attributes that are left out, so a BioSample can match a keyword through a value that its page does not show.

The exports return every matching entry as TSV or as newline-delimited JSON (`application/x-ndjson`), and every matching accession of a type as plain text with one accession per line. Accession lists exist for `biosample`, `sra-experiment`, `sra-run`, and `bioproject`.

## Terms

`GET /api/terms/{termId}` returns one term of the dataset: its label, its synonyms, its direct parent terms, the ontology that the prefix of its ID names, and the address of its page on the site of that ontology. Synonyms that differ from the label or from each other only in letter case are left out. The api derives the address from the prefix: Cellosaurus for `CVCL`, NCBI Gene for `NCBIGene`, and the EBI Ontology Lookup Service for `CL`, `UBERON`, `MONDO`, `CHEBI`, and `EFO`. A term with another prefix has no address. Clients take the address from the api and do not hold the addresses of ontologies themselves. The names of ontologies come from the same place: `GET /api/dataset` returns the name of each prefix of the terms of the dataset, and a prefix without a name in the api is its own name.

## Aggregations

An aggregation counts the matches of `q` per element along one or two **dimensions**, in a counting unit. A dimension is a DSL field, such as `disease`, `disease_status`, `library_strategy`, `date_published`, or `bioproject`. Every element carries a clause on each dimension of the aggregation that represents it, for example `disease:"MONDO:0007254"` for a bar of a distribution, or one clause per axis for a cell of a cross-tabulation.

The two dimensions of a cross-tabulation are different fields, and the dimension of a trend is not `date_published`, because the trend already counts per year. `disease` and `disease_status` are different dimensions. A request that breaks either rule is rejected with status 400 and slug `invalid-dimension`.

The bucket of an element has `value`, `label`, and `count`, as a facet bucket of the DDBJ Search API, and the element's `clauses` in addition.

An element of an annotation term dimension also tells where the term sits in the ontology, so that a client can show the elements of a list as a tree. `parents` has every element of the same list that is a direct parent of the term. A term can have several parents in a list. `hasChildren` is true if a direct child term of the term has a count above 0 in the population of the list, in the same counting unit. `GET /api/terms/children` returns exactly those child terms. To get the children of a term element of a cross-tabulation, call it with the `populationQ` of the cross-tabulation as `q`, so that both use the same population.

A distribution on an annotation term dimension also returns `withoutTerm`, the count of its population that has no term of the field: the population combined by `AND` with `NOT <field>_status:mapped`, in the same counting unit. The elements count only the matches that have a term, so `withoutTerm` shows how much of the population they cannot count. For example, if most BioSamples of a condition state no disease, then the bars of the disease distribution cover a small part of the condition.

### Self-exclusion

By default, the population of an aggregation is `q`, as in the DDBJ Search API.

With `facetSelfExclude=true`, an aggregation is computed without the conditions on its own dimensions. The population of the aggregation is `q` with every top-level conjunct removed whose clauses are all on the aggregation's dimensions. The remaining conditions apply as usual. Each response returns the population that it was computed from as `populationQ`.

The top-level conjuncts are the operands of the outermost `AND` after nested `AND` groups are merged. For example, `a AND (b AND c)` has three top-level conjuncts.

Self-exclusion keeps every element of a dimension visible while one of its elements is selected, so that the selection can be compared with the alternatives. The UI computes the distributions, the cross-tabulations, and the trend with self-exclusion. The counts that the UI shows next to the values that a condition can take, in the condition panel and in the term search, are also computed with self-exclusion. The UI computes the project statistics with self-exclusion, so that the BioProjects in `q` stay listed with the other BioProjects that match the rest of `q`. The UI computes the entry list from `q` itself.

### Default elements

If a request does not name the elements of a dimension, then the api chooses the elements.

- For an annotation term dimension, the api chooses the terms that are assigned directly to the most BioSamples in the population of the aggregation. The count of a term includes its descendants, but the choice does not. A term that is only an ancestor of the assigned terms, such as the root of an ontology, is therefore not chosen.
- The api adds the elements that `q` names in a top-level clause, or in a top-level disjunction of clauses, on the dimension without `NOT`. A selected element is therefore present even if it is not one of the most frequent elements.
- The api returns term, assay, and organism elements in descending order of their counts.

The term search (`GET /api/terms`) chooses its terms in the population that it counts them in. If the search text is empty, then it chooses the terms that are assigned directly to the most BioSamples of that population, as for the elements of an annotation term dimension. If the search text is not empty, then every term of the dataset whose label, synonym, or ID contains the text is a candidate. This includes a broad term that is counted only through its descendants, so that a user can find such a term and choose all of its descendants at once. The OpenAPI document describes the order of the hits.

### Trend

A trend counts the condition for each publication year of the BioSample. It returns every year from the first to the last year in which its population has a match, with a count of 0 for a year without one. With self-exclusion, the population of these counts is `q` without the conjuncts on `date_published`.

If a request names a dimension, then the trend also counts each element of the dimension for each year. With self-exclusion, the population of these counts also excludes the conjuncts on that dimension.

The trend also returns `allEntries`, the count of the whole population for each year that the trend returns, in the same counting unit. Neither `q` nor self-exclusion applies to these counts, so that a client can compare the condition with the whole dataset.

`yearFrom` and `yearTo` limit the years that a trend returns. They do not change the population, the counts, or the default elements. `firstYear` and `lastYear` are the first and the last year in which the populations of the trend have a match, whether or not the years are limited, so that a client can offer the years to choose from. If `yearFrom` is after `yearTo`, then the trend returns no years, as a reversed date range matches nothing in the DDBJ Search API.

### Expected counts in cross-tabulations

For each cell of a cross-tabulation, the api compares the count of the cell with the count that the cell would have if the two dimensions were independent. It returns the expected count, the ratio to the expected count, and the adjusted standardized residual, in the selected counting unit. With `N` the count of the aggregation population, `R` the count of the row, `C` the count of the column, and `O` the count of the cell:

- expected count `E = R × C / N`, or null when `N` is zero
- ratio to the expected count `O / E`, or null when `E` is null or zero
- adjusted standardized residual `r = (O − E) / sqrt(E × (1 − R / N) × (1 − C / N))`, or null when the denominator is zero

Row and column counts are counts of the matches of the row or the column, not sums of cell counts.

The ratio and the residual answer different questions. The ratio is the size of the difference: `2` means twice the expected count, and `0.5` means half of it. The residual tells whether chance can explain the difference, and it grows with the population. In a population of millions, a cell whose count is 1% above its expected count can have a residual far above 2. A cell is therefore classified only if both its ratio and its residual pass a threshold.

A cell with `E ≥ 5` is classified as follows. Cells with `E < 5` are not classified.

| Class | Condition |
|---|---|
| Gap | `O = 0` |
| Under-represented | `O > 0`, `O / E ≤ 1/2`, and `r ≤ −2` |
| Over-represented | `O / E ≥ 2` and `r ≥ 2` |

The thresholds are fixed. Rows and columns overlap and BioProject counts are distinct counts, so `E` and `r` describe how far a cell departs from independence rather than constitute a statistical test.

### Counts of the whole population

`GET /api/dataset` returns the BioSample counts of the whole population for each target assay, for each organism, and for each annotation field. The count of a field is the number of BioSamples with a term in the field. build computes these counts, so they stay the same for a store, and a client can show them without an aggregation request. Each count equals the count of an element of a distribution with an empty `q` in the BioSample unit. For example, the count of the field `disease` equals the count of the element `mapped` of the distribution on `disease_status`.

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

The state of `/entries` is represented only by `q` and view parameters (view tab, counting unit, cross-tabulation axes, and similar), and all of them are part of the URL. The same URL returns the same result against the same store version.

The `q` in a URL is the same string as the `q` of the API.

## Compatibility

- The version of the OpenAPI document identifies the version of the contract.
- Before version 1.0.0, any version may change the contract incompatibly.
- From version 1.0.0, adding endpoints, parameters, or response properties is a compatible change. Clients ignore properties that they do not know. Removing or renaming anything, or changing its meaning, is an incompatible change and increments the major version.
