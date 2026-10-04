# API

This document specifies the rules that span operations or values: the conventions shared with the DDBJ Search API, the condition DSL, how entries and aggregations count, the error rules, the limits, the correspondence between queries and UI views, the relationship to URLs, and the compatibility policy. The OpenAPI document defines each operation, its parameters, the set of values of each parameter, and the meaning of each response property. The OpenAPI document refers to the headings of this document for the rules.

The api is a public API without authentication. The frontend and other clients use the same API.

- Swagger UI: `/api`
- ReDoc: `/api/redoc`
- OpenAPI document: `/api/openapi.json`. FastAPI serves its OpenAPI document at `/openapi.json` by default, so the web server in front of the api redirects `/openapi.json` to `/api/openapi.json` ([operations.md](operations.md#crawlers)).
- `/llms.txt`: a short entry for programs such as LLM agents, with condition examples and recipes for common tasks
- `/llms-full.txt`: this document and [data-model.md](data-model.md) in one file. The build of the web image generates it, so it is always the version of the deployed api.

The head of every HTML page of the UI links the OpenAPI document (`rel="service-desc"`), the Swagger UI (`rel="service-doc"`), and `/llms.txt` (`rel="alternate"` with `type="text/markdown"`). A program that reads a page therefore finds the API without running the scripts of the page.

## Conventions

The api follows the conventions of the [DDBJ Search API](https://ddbj.nig.ac.jp/search/api/docs), so that a client of one API can use the other in the same way.

- Every path starts with `/api`. Paths have no trailing slash.
- JSON property names and query parameter names are camelCase, for example `perPage` and `datasetVersion`. Field names of the condition DSL are snake_case, for example `organism_id`, as in the DSL of the DDBJ Search API.
- Entry types and accession types use the names of the DDBJ Search API. The schemas `EntryType` and `AccessionType` of the OpenAPI document list them.
- A paginated list returns `pagination` and `items`. `page` starts at 1. A `page` after the last page returns status 200 with empty `items` and `hasNext` false, however large `page` is.
- A `sort` parameter has the form `{field}:{direction}`, where `direction` is `asc` or `desc`.
- Every response has an `X-Request-ID` header. If the request has an `X-Request-ID` header, then the response repeats its value. Otherwise, the api generates a UUID.
- Cross-origin requests are allowed from every origin, with every method and header.
- Every JSON response includes `datasetVersion`, the identifier of the dataset version defined in [build.md](build.md): the name, the creation time, the model, and a digest of the complete version information. The exceptions are `GET /api/service-info` and the problem documents. The exports are not JSON. They name the dataset version in the `X-Dataset-Version` response header, with the name, the creation time, and the digest ([Entries](#entries)).
- Counts change with every build of the dataset. To cite a result, record the `name`, `createdAt`, `model`, and `digest` of `datasetVersion`, the address of the api, and the date of access.

### Errors

Errors are RFC 7807 Problem Details (`application/problem+json`) with `type`, `title`, `status`, `detail`, `instance`, `timestamp` (ISO 8601, UTC), and `requestId` (the value of the `X-Request-ID` header). `detail` names the wrong parameter or value, and lists the values that the api accepts where the set is small.

- `type` is `about:blank` for errors that the HTTP status describes, such as an unknown accession (404) or a request that does not match the OpenAPI document (422). `title` is the HTTP status phrase.
- `type` is `https://ddbj.nig.ac.jp/problems/<slug>` for errors specific to the api. Errors of the condition DSL use the slugs of the DDBJ Search API where the same error exists, for example `unknown-field` and `unexpected-token`.

A client can predict the status from the OpenAPI document. The OpenAPI document of each operation declares the statuses that the operation can return, and the slugs of its 400 and 503. It does not declare 404 for an unknown path, 405, or the statuses 413 and 429, which the web server in front of the api returns.

| Status | When |
|---|---|
| 422 | The request does not match the OpenAPI document of the operation. Examples: a query parameter that the operation does not declare, a missing parameter, a value of the wrong type, out of range, outside an enumeration, or longer than the limit, a body that is not JSON, an unknown or a missing key in a body, and an empty `clauses`. |
| 400 | The request matches the OpenAPI document, but it breaks a rule of the condition DSL or of the dataset. The slug of `type` names the rule. |
| 404 | The path does not exist, or the entry type, the accession, or the term does not exist. For a path under `/api` without an operation, `detail` points to the OpenAPI document. |
| 405 | The method is not allowed for the path. The `Allow` header lists the allowed methods. |
| 413 | The body is too large. The web server in front of the api returns this status ([operations.md](operations.md#limits-of-the-web-server)). |
| 429 | One client address has too many requests in progress, or too many exports in progress. The web server in front of the api returns this status, with a `Retry-After` header ([operations.md](operations.md#limits-of-the-web-server)). |
| 500 | The api failed unexpectedly. `detail` does not give the cause. |
| 503 | The api is at its limits (see [Limits](#limits)). The slug of `type` names the limit. |

A parameter whose name differs only in letter case, such as `facetselfexclude`, is an unknown parameter. A parameter that a request repeats takes its last value.

The 400 response and the 503 response of each operation in the OpenAPI document list the slugs that the operation can return. Each slug has its cause and its remedy. The descriptions come from one table in the api (`backend/src/bsllmner_viewer/api/problems.py`), so every operation describes a slug in the same words. The rules that cause the slugs are in [Condition DSL](#condition-dsl), [Aggregations](#aggregations), [Default elements](#default-elements), and [Limits](#limits).

The clauses of `POST /api/dsl/select` are checked by the rules of a condition. A clause with a field or a value that a condition would reject gets the slug that the same clause gets in `q`, for example `unknown-field` and `invalid-value`. `invalid-ast` is only for a clause that is not a value and not a range.

An export reads the store before it sends the first byte. If that fails, then the response is an error status: 500, or one of the 503 statuses of [Limits](#limits). If the export fails after the response has started, then the api cannot change the status. It ends the response without completing it. In HTTP/1.1, the last chunk does not arrive, and a client that checks the end of the response sees an error. A client must treat a response that did not complete as incomplete. A response that completed has every matching entry.

### Service information

`GET /api/service-info` is the endpoint for health monitoring.

The api starts only with a store that it can open and whose schema version its code reads. If the store file is missing, is not a DuckDB file, or has another schema version, then the process stops at startup and the endpoint does not answer. While the api runs, the endpoint returns status 200, and its `store` property is `unavailable` if the api cannot query the store or if the store file changed after the api opened it. A store file that someone overwrote or truncated while the api served it is therefore reported.

### Limits

The api limits the size of a request and the resources that one request uses. The limits apply to each api worker process.

- A condition (`q`), a keyword, a search text (`query` of `GET /api/terms`), and a value of a clause have at most 4096 characters. A field name, an element, and a term ID have at most 256 characters. An accession has at most 64 characters.
- A value that is too long is rejected with status 422. There are two exceptions. A `q` in a query string that is too long is rejected with status 400 and slug `unexpected-token`. A named element that is too long is rejected with status 400 and slug `invalid-element`.
- A condition nests groups at most 5 levels deep and has at most 512 nodes. A deeper or larger condition is rejected with status 400 and slug `nest-depth-exceeded`.
- The limits of the number of keywords, clauses, and elements are in [Keywords](#keywords), [Condition DSL](#condition-dsl), and [Default elements](#default-elements).
- A worker runs a limited number of requests that read the store at the same time. These are the entry list, the aggregations, the project statistics, the term search, and the child terms. A request without a free slot waits for up to 10 seconds. If no slot is free after that time, or if many requests wait already, then the api answers status 503 with slug `server-busy` and a `Retry-After` header. A client retries after that time.
- A worker runs at most 2 exports at the same time. The wait and the answer are the same as for the other requests. An export does not have a limit on the number of entries.
- A request may read the store for 60 seconds. The time starts when the request gets a slot, and it includes the work between the queries. When the time has passed, the api stops the running query and answers status 503 with slug `query-timeout`. The wait for a slot does not count. An export has this limit for each page of entries, or for the first read of an accession list. The time that the client takes to read the response does not count.
- A query that needs more memory than a worker may use, or more temporary disk space, is stopped. The api answers status 503 with slug `query-too-large`. A narrower condition needs less.

The numbers in this list are the defaults. [operations.md](operations.md#limits-of-a-worker) lists the settings that change them.

### Caching

A response changes only when the api serves another store, another version of its code, or other versions of the packages that it runs on. A client can therefore keep the responses that it gets, and ask the api whether they are still current.

- A GET response with status 200 has an `ETag` header and the header `Cache-Control: no-cache`. The exports and `GET /api/service-info` do not have these headers.
- To check a response that you keep, send the same request with its `ETag` value in the `If-None-Match` header. If the response is still current, then the api answers status 304 without a body. Otherwise, the api answers status 200 with the current response and its `ETag`. A browser sends `If-None-Match` by itself. A script of another origin can read the `ETag` header.
- The `ETag` belongs to the method, the path, and the query string. The same parameters in another order make another request with another `ETag`.
- The web server in front of the api can compress a response. It then marks the `ETag` as weak, for example `W/"0123abcd"`. The api accepts the value with and without `W/` in `If-None-Match`.
- The api answers status 304 without reading the store, so the request does not take a slot of [Limits](#limits). Each api worker also keeps recent responses in memory, and it answers a repeated request without reading the store.

## Condition DSL

A condition is a single string, `q`. Queries for entries, aggregations, and exports all accept the same `q`. If `q` is omitted or empty, then the condition matches the whole population.

### Grammar

The grammar is the Lucene subset used by the DDBJ Search API search DSL (the `/db-portal/*` endpoints). A condition string parses to an AST of the same shape in both.

- `field:value`, `field:"phrase"`, and `field:[a TO b]`
- keywords without a field: `hypoxia organoid` and `"breast cancer"`
- phrases in double or single quotes: `"breast cancer"` and `'breast cancer'`. Inside a phrase, `\"`, `\'`, and `\\` stand for a double quote, a single quote, and a backslash.
- `AND`, `OR`, and `NOT` (upper case), and grouping with `( )`. An operator is followed by whitespace, the end of the condition, or one of the characters `( ) [ ] { } " ' : ^ ~ * ? /`. If another character follows it, then the operator is part of a word. For example, `NOT (a)` and `NOT(a)` are negations, and `NOTCH1` is one word.
- The JSON representation of the AST has the same shape, with node types discriminated by `op`.

`GET /api/dsl/parse` converts the string to the AST. The response has the shape of `/db-portal/parse` (`{ast}`) of the DDBJ Search API, with `labels`, `selected`, and `keyword` added. The `selected` clauses are the clauses that selecting an element treats as already in the condition (see [From elements to conditions](#from-elements-to-conditions)).

`POST /api/dsl/select` and `POST /api/dsl/keyword` return the changed condition as `dsl`, with the same additions. The body of `POST /api/dsl/select` has at most 512 clauses. The api has no operation that converts an AST to a string.

Compatibility covers the grammar and the AST shape. The set of fields and the evaluation of fields and keywords are specific to this API.

### Fields

| Kind | Example | Matches where |
|---|---|---|
| Annotation term | `disease:"MONDO:0007254"` | the field has the given term or one of its descendants |
| Annotation status | `disease_status:unmapped` | the field has a status under the given group |
| Assay | `library_strategy:ATAC-seq` | the experiment has the given `library_strategy`, which is one of the target assays of the dataset |
| Organism | `organism_id:9606` | the BioSample's organism has the given NCBI Taxonomy ID |
| Publication date | `date_published:[2015-01-01 TO 2020-12-31]` | the BioSample's publication date is in the range |
| BioProject | `bioproject:PRJNA123456` | the BioSample belongs to the given BioProject |

- A range with a start after its end is valid and matches nothing. `NOT` of it matches the whole population.
- A clause on an annotation term field matches the term and its descendants. The descendants follow is-a and part-of relations ([data-model.md](data-model.md#term-hierarchy)).
- An `organism_id` value is a decimal number of ASCII digits with no sign and no leading zero, and at most 2147483647. Any other value is rejected with status 400 and slug `invalid-value`.
- An annotation term value is a term ID in the form `PREFIX:ID`, such as `UBERON:0000955`. A value in another form is rejected with status 400 and slug `invalid-value`, and `detail` points to `GET /api/terms`, which finds term IDs. A term ID in this form that the dataset does not have is valid and matches nothing.
- An annotation status value is one of the three status groups, which [data-model.md](data-model.md#annotation-status) defines. A single status, such as `mapped_exact`, is rejected with status 400 and slug `invalid-value`, and `detail` lists the groups. The status of each annotation is in the entries and the exports. The count of a group is the `total` of an aggregation of `(<q>) AND <field>_status:<group>`.
- A `library_strategy` value is spelled exactly as a target assay of `GET /api/dataset`. Any other value is rejected with status 400 and slug `invalid-value`, and `detail` lists the target assays.
- A date is a calendar date in the form `YYYY-MM-DD`. Another date is rejected with status 400 and slug `invalid-date-format`.
- `date_published` takes a date or a range of dates, and no other field takes a range. A value of another form, such as a quoted date, is rejected with status 400 and slug `invalid-operator-for-field`.
- A clause with an empty value is rejected with status 400 and slug `missing-value`.
- Annotation field names are the field names of the select configuration. `_status` is a suffix appended to a field name.
- Other fields use the DDBJ Search API field name when the DDBJ Search API has a field for the same concept.
- The evaluation of clauses against BioSamples and experiments is defined in [data-model.md](data-model.md#condition-evaluation).
- `GET /api/dataset` lists the fields of the dataset, each with its kind. The implementation is the source of truth for the set of available fields.

### Keywords

A term without a field is a keyword, such as `hypoxia organoid` or `"breast cancer"`. A keyword matches an entry whose searchable text contains it. The searchable text of a BioSample is defined in [data-model.md](data-model.md#condition-evaluation). Matching follows the free-text search of the DDBJ Search API wherever the two can be compared.

- Letters are compared case-insensitively. Every character other than a letter or a digit separates words.
- Every word of a keyword must occur in the text, in any order and in any part of the text. `breast cancer` matches a BioSample whose title says "breast" and whose disease is "cancer".
- A word matches whole words, so `cell` does not match `cellulose`. The last word of a keyword also matches the start of a word, so `organoid` matches `organoids` and `H3K27` matches `H3K27ac`. A last word of one character matches whole words only.
- A word that contains symbols, such as `IL-4` or `CD4+`, matches its parts in sequence (`IL 4`) and its parts written together (`IL4`). A word of the text that joins its parts with symbols, such as `MCF-7`, also matches the parts written together, so `MCF7` matches `MCF-7`.
- A quoted keyword is a phrase. Its words must occur in sequence within one value, such as one attribute value or the title.
- A phrase and other keywords are joined with `AND`, for example `"breast cancer" AND organoid`. As in the DDBJ Search API, a phrase next to words without an operator, such as `"breast cancer" organoid`, is rejected with status 400 and slug `unexpected-token`. The `keyword` of `POST /api/dsl/keyword` accepts that text and returns a condition that joins its parts with `AND`.
- Words with symbols and phrases do not match the start of a word.
- A word in the form of an accession matches the entry that has that accession, case-insensitively. The accession can be that of a BioSample, an SRA Experiment, an SRA Run, or a BioProject, for example `SAMN14864678` or `SRR11745799`. An SRA Experiment or SRA Run accession matches only the entry of its experiment. A client finds the BioSample of an SRA Run by using its accession as the keyword.
- Wildcards are rejected with an error, as in the DDBJ Search API. A keyword without a letter or a digit is rejected with an error.

Unlike the DDBJ Search API, a keyword may appear anywhere in a condition, including under `OR` and `NOT`, and a condition may have several keywords. Each keyword is a scan of the searchable text, so a condition has at most 16 keywords and at most 64 words in all of its keywords. A phrase is one word. A condition over these limits is rejected with status 400 and slug `invalid-value`.

## Entries

An entry is a BioSample. `GET /api/entries/biosample` lists the BioSamples that match `q`, in the sense of the BioSample counting unit in [data-model.md](data-model.md#counting). Each item lists the experiments of the BioSample that match `q`. The annotations belong to the BioSample, and a BioSample can have several experiments, so an experiment is listed in the item of its BioSample and is not an entry of its own. An entry list is always computed from `q` itself, and its `pagination.total` is the count of the condition in the BioSample unit.

`GET /api/entries/biosample/{accession}` returns one BioSample with its original metadata ([data-model.md](data-model.md#entities)), its annotations with evidence, its experiments, and its BioProjects. The BioSample does not have to be in the population; its experiments show which of them are. Each annotation with a term also has the clause on its field and term, so that a client can make a condition from it. An accession that is not that of a BioSample is answered with status 404. A client finds the BioSample of another accession with the accession as a keyword in `q` ([Keywords](#keywords)).

The original metadata is a list of items in three kinds: the description, the record, and the attributes. The items come in this order of their kinds, so that the attributes come last and the items that describe the BioSample as a whole come first. Evidence identifies an item by its position in the list, and it says whether the match is in the name or in the value of the item. [provenance.md](provenance.md#matching-strategies) defines the matching strategies.

- The description is always returned: the title, the description paragraphs, the sample name, and the synonyms, named `Title`, `Description`, `Sample name`, and `Synonym`.
- An item of the record is returned only when evidence of the BioSample points to it. It is named by a short name for its path in the input entry, such as `Owner` for `Owner.Name` and `Status` for `Status.when`. A path without a short name is its own name.
- An attribute is named by its attribute name. The attributes leave out each attribute whose name bsllmner-mk2 lists in its `filter_keys.json` ([build.md](build.md#runs)) and that no evidence of the BioSample points to. Such an attribute records how the BioSample was submitted and archived, so it is shown only when an annotation of the BioSample was derived from it. For example, `INSDC center name` is left out, but a `Submitter Id` of `E-MTAB-13151:ChIP_ETO2_DMSO_rep1` stays when the ChIP antigen ETO2 was found in it. Keywords still match the values of the attributes that are left out, so a BioSample can match a keyword through a value that its page does not show.

The exports return every matching entry as TSV or as newline-delimited JSON (`application/x-ndjson`), and every matching accession of a type as plain text. Each line of the NDJSON is an item of the entry list. The entries are in the order of the entry list, and the accessions are in ascending order.

Every export has the response header `X-Dataset-Version: <name> <createdAt> <digest>`, for example `X-Dataset-Version: "bsllmner-mistral-all" 2026-10-03T21:29:30Z 0f8b06f33b9f2567`. `<name>` is the name of the dataset as a JSON string. In a JSON string, a line break and every non-ASCII character are escaped, such as `\n` and `\u00e9`, so the value is always one line of ASCII. A browser of another origin can read the header.

An accession list starts with one header line, and then has one accession per line. A client skips the header line, which starts with `#`. The header line has the form `# bsllmner-viewer <type> accessions; q=<q>; dataset=<name> <createdAt> <digest>`, with the same dataset version as the response header. `<q>` is the condition as a JSON string, so the header line is always one line. If the condition is empty, then `<q>` is `""`. The TSV and the NDJSON have no header line for the dataset version, so that every line of the NDJSON is an item and the first line of the TSV names the columns.

In the TSV, a header line names the columns, and every row has as many cells as the header. A cell with several values joins them with `;`. After the entry columns come one column per annotation field. Each annotation in these columns is `value|termId|label|status`: always four parts in this order, with an empty part when the annotation has no value, no term, or no label. A client splits a cell on `;` and then each annotation on `|`. The characters that delimit a cell are percent-encoded inside a part (`%` as `%25`, `|` as `%7C`, `;` as `%3B`, tab as `%09`, carriage return as `%0D`, line feed as `%0A`), so a value that contains them still splits into the same four parts. In the other columns, a tab or a line break in a value is replaced with a space. The TSV writes every other value as it is, so a spreadsheet program can read a cell that starts with `=`, `+`, `-`, or `@` as a formula. A client that needs the exact values reads the newline-delimited JSON.

## Terms

`GET /api/terms/{termId}` returns one term of the dataset, with its direct parent terms. An empty `parents` means only that the term is a root in the dataset, and a root can have descendants. A client finds out whether a term has descendants from `descendantCount` of its hit in `GET /api/terms`. A condition on a term with a `descendantCount` of 0 matches only the term itself ([data-model.md](data-model.md#term-hierarchy)). The api derives the ontology and the address of the term page from the prefix of the term ID. A term with a prefix that the api does not know has no address. Clients take the address from the api and do not hold the addresses of ontologies themselves. The names of ontologies come from the same place: `GET /api/dataset` returns the name of each prefix of the terms of the dataset, and a prefix without a name in the api is its own name.

## Aggregations

An aggregation counts the matches of `q` per element along one or two dimensions, in a counting unit. A dimension is a DSL field of the kind term (an annotation field such as `disease`), assay (`library_strategy`), organism (`organism_id`), or date (`date_published`). The elements of a dimension are term IDs, target assays, NCBI Taxonomy IDs, or years, by the kind of the dimension. Every element carries a clause on each dimension of the aggregation that represents it, for example `disease:"MONDO:0007254"` for a bar of a distribution, or one clause per axis for a cell of a cross-tabulation.

The `total` of a distribution or a cross-tabulation is the count of its population in its counting unit. The count of a condition in a unit is therefore the `total` of a distribution of the condition in that unit, with `facetSelfExclude` left false. For the BioSample unit, it is also the `pagination.total` of the entry list. The api has no operation that returns only a count.

The two dimensions of a cross-tabulation are different fields, and the dimension of a trend is not `date_published`, because the trend already counts per year. A request that breaks either rule is rejected with status 400 and slug `invalid-dimension`.

A `field`, `row`, or `col` that is not a field of the dataset is rejected with status 400 and slug `unknown-field`, as in a condition. A field of the dataset that cannot be a dimension, such as `bioproject` or a status field (`<field>_status`), is rejected with slug `invalid-dimension`. The term search and the child terms accept only annotation fields, so they reject the other fields with `invalid-dimension`. `detail` lists the accepted fields.

The bucket of an element has `value`, `label`, and `count`, as a facet bucket of the DDBJ Search API, and the element's `clauses` in addition.

An element of an annotation term dimension also tells where the term sits in the ontology, so that a client can show the elements of a list as a tree. A term can have several parents in a list. The child terms that `GET /api/terms/children` returns are exactly the child terms that make `hasChildren` of the term true: the direct child terms with a count above 0 in the population of the list, in the same counting unit. To get the children of a term element of a cross-tabulation, call it with the `populationQ` of the cross-tabulation as `q`, so that both use the same population.

The counts of an annotation term element are counts of the units that have the term or a descendant of it. The counts of the statuses of an element count units, not annotations.

A distribution on an annotation term dimension also returns `withoutTerm`, the count of its population that has no term of the field. The elements count only the matches that have a term, so `withoutTerm` shows how much of the population they cannot count. For example, if most BioSamples of a condition state no disease, then the bars of the disease distribution cover a small part of the condition.

The project statistics (`GET /api/projects`) count the BioSamples and SRA Experiments that match the population, not all of each BioProject. A BioProject with 100 BioSamples, of which 5 match the population, has a BioSample count of 5.

### Self-exclusion

By default, the population of an aggregation is `q`, as in the DDBJ Search API.

With `facetSelfExclude=true`, an aggregation is computed without the conditions on its own dimensions. The population of the aggregation is `q` with every top-level conjunct removed whose clauses are all on the aggregation's dimensions. The remaining conditions apply as usual. Each response returns the population that it was computed from as `populationQ`.

The top-level conjuncts are the operands of the outermost `AND` after nested `AND` groups are merged. For example, `a AND (b AND c)` has three top-level conjuncts.

The dimensions of an operation are its `field`, `row`, and `col`. The trend computes `total` without the conjuncts on `date_published`, and `series` also without the conjuncts on its `field` ([Trend](#trend)). The project statistics have the dimension `bioproject`. The term search and the child terms have their `field`. The term search without a `field` computes each annotation field in the population without the conjuncts on that field.

Self-exclusion keeps every element of a dimension visible while one of its elements is selected, so that the selection can be compared with the alternatives. The UI computes the distributions, the cross-tabulations, and the trend with self-exclusion. The counts that the UI shows next to the values that a condition can take, in the condition panel and in the term search, are also computed with self-exclusion. The UI computes the project statistics with self-exclusion, so that the BioProjects in `q` stay listed with the other BioProjects that match the rest of `q`. The UI computes the entry list from `q` itself.

### Default elements

If a request does not name the elements of a dimension, then the api chooses the elements.

- For an annotation term dimension, the api chooses the terms that are assigned directly to the most BioSamples in the population of the aggregation. The count of a term includes its descendants, but the choice does not. A term that is only an ancestor of the assigned terms, such as the root of an ontology, is therefore not chosen.
- For an assay dimension or an organism dimension, the api chooses the assays or the organisms of the most BioSamples in the population of the aggregation, whatever the counting unit of the request.
- For a date dimension, the api chooses every year in which the population of the aggregation has a match.
- The api adds the elements that `q` names in a top-level clause, or in a top-level disjunction of clauses, on the dimension without `NOT`. They come in addition to the `limit` elements that the api chose, so a selected element is present even if it is not one of the most frequent elements.
- The api returns term, assay, and organism elements that it chose, and the elements that `q` names, in descending order of their counts in the counting unit of the request. The count of a term includes its descendants, and the count of a series of a trend is the sum of its counts over the years. Elements with the same count are in ascending order of the element, and organism IDs compare as numbers. The elements of a distribution, the rows and the columns of a cross-tabulation, and the series of a trend all follow this order. Elements that the request names with `elements`, `rowElements`, or `colElements` keep the order of the request.
- A named element follows the value rules of a clause on the same dimension. A named term element is a term ID in the form `PREFIX:ID`, and a named assay element is a target assay of the dataset. A named organism element is an NCBI Taxonomy ID, and a named year element is a year from 1000 to 9999. Each of the last two is a decimal number of ASCII digits with no sign and no leading zero, and an organism ID is at most 2147483647. Any other element is rejected with status 400 and slug `invalid-element`, so an element that gives status 400 as a clause also gives status 400 as a named element. A request names at most 100 elements of a dimension. A request with more is rejected with status 400 and slug `too-many-elements`. The `limit` of a cross-tabulation is at most 100, and a larger `limit` is rejected with status 422.

The term search (`GET /api/terms`) chooses its terms in the population that it counts them in. If the search text is empty, then it chooses the terms that are assigned directly to the most BioSamples of that population, as for the elements of an annotation term dimension. If the search text is not empty, then every term of the dataset whose label, synonym, or ID contains the text is a candidate. This includes a broad term that is counted only through its descendants, so that a user can find such a term and choose all of its descendants at once.

The search returns the `limit` best candidates. It chooses them first by how they match the text (a label or an ID equal to it, a synonym equal to it, a label or an ID that contains it, and a synonym that contains it), then by the BioSamples that are assigned directly to them in the population, and then by those in the whole dataset. It returns the chosen hits in the order of how they match the text, and then of `count`.

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

`GET /api/dataset` returns the BioSample counts of the whole population for each target assay, for each organism, and for each annotation field. build computes these counts, so they stay the same for a store, and a client can show them without an aggregation request. The count of an assay or an organism equals the count of its element in a distribution with an empty `q` in the BioSample unit. The count of a field is the number of BioSamples with a term in the field, so it equals the count of `<field>_status:mapped`.

### Invariant

For every element of an aggregation, the element's count equals the count of `q'` combined with the element's clauses by `AND`, in the same counting unit, where `q'` is the population of the aggregation.

### From elements to conditions

An element with one clause is a bar of a distribution or a point of the trend of the condition. Selecting the element in the UI toggles the clause in `q`:

- The clauses that count as already in `q` are the top-level clauses and the clauses of a top-level disjunction of clauses on one field, outside any `NOT`. The api returns them as `selected` in the responses of parse, select, and keyword.
- If the clause is not in `selected` and `q` has a top-level conjunct that is a clause, or a disjunction of clauses, on the same field without `NOT`, then the new clause is joined with `OR` to the first such conjunct.
- If the clause is not in `selected` and `q` has no such conjunct, then the new clause is added as a new top-level conjunct with `AND`.
- If all clauses of the element are in `selected`, then selecting the element removes the clauses from every top-level conjunct that holds them, and removes a conjunct that becomes empty.

For example, selecting `disease:A`, then `library_strategy:ATAC-seq`, then `disease:B` produces `(disease:A OR disease:B) AND library_strategy:ATAC-seq`.

An element with two clauses is a cell of a cross-tabulation or a point of the trend of an element. Selecting the element in the UI narrows the condition to the element. The new condition is the population of the aggregation combined by `AND` with both clauses. The count of the new condition equals the count of the element, in the same counting unit.

For example, with `q` equal to `library_strategy:ChIP-Seq`, selecting the cell of `cell_line:A` and `library_strategy:RNA-Seq` in a cross-tabulation of the two fields produces `cell_line:A AND library_strategy:RNA-Seq`.

`POST /api/dsl/select` performs both operations on behalf of clients, so that the UI and other clients derive the same condition from the same selection.

## Queries and UI views

Every count, table, and chart that the UI shows comes from one API query with the `q` and the view parameters of the UI state. One view can show the results of several queries. Exports are generated from the same `q`. Calling the API with the `q` and view parameters of a UI state returns the result shown in that state.

## URLs

The UI has three pages: `/` is the start page, `/entries` is the page that shows the entries and aggregations of a condition, and `/entries/{accession}` is the page of one BioSample.

The state of `/entries` is represented only by `q` and view parameters (view tab, counting unit, cross-tabulation axes, and similar), and all of them are part of the URL. The same URL returns the same result against the same store version.

The `q` in a URL is the same string as the `q` of the API.

## Compatibility

- The version of the OpenAPI document identifies the version of the contract.
- Before version 1.0.0, any version may change the contract incompatibly.
- From version 1.0.0, adding endpoints, parameters, or response properties is a compatible change. Clients ignore properties that they do not know. Removing or renaming anything, or changing its meaning, is an incompatible change and increments the major version.
