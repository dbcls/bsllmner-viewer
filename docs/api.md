# API

The api is a public HTTP API without authentication. The frontend and other clients use the same API.

This document specifies the rules that apply to more than one operation or value:

- the conventions that the api shares with the DDBJ Search API
- errors, limits, and caching
- the condition domain-specific language (DSL)
- how the api computes entries, terms, and aggregations
- how the URLs of the UI correspond to queries
- the compatibility policy

The OpenAPI document defines each operation, its parameters, the values that each parameter accepts, and the meaning of each property of a response. For the rules, the descriptions in the OpenAPI document refer to the headings of this document.

These addresses describe the api:

- Swagger UI: `/api`
- ReDoc: `/api/redoc`
- OpenAPI document: `/api/openapi.json`. FastAPI serves its OpenAPI document at `/openapi.json` by default, so the web server of a deployment, which receives every request before the api, redirects `/openapi.json` to `/api/openapi.json` ([deployment.md](deployment.md#crawlers-and-agents)).
- `/llms.txt`: a short entry for programs such as agents that use a large language model (LLM), with condition examples and recipes for common tasks
- `/llms-full.txt`: this document and [data-model.md](data-model.md) in one file. The build of the web image generates `/llms-full.txt`, so `/llms-full.txt` always matches the version of the deployed api.

The head of every HTML page of the UI links the OpenAPI document (`rel="service-desc"`), the Swagger UI (`rel="service-doc"`), and `/llms.txt` (`rel="alternate"` with `type="text/markdown"`). Therefore, a program that reads a page finds the API without running the scripts of the page.

## Conventions

The api follows the conventions of the [DDBJ Search API](https://ddbj.nig.ac.jp/search/api/docs), so that a client of one API can use the other API in the same way.

- Every path starts with `/api` and has no trailing slash.
- JSON property names and query parameter names are camelCase, for example `perPage` and `datasetVersion`. Field names of the condition DSL are snake_case, for example `organism_id`, as in the DSL of the DDBJ Search API.
- Entry types and accession types use the names of the DDBJ Search API. The schemas `EntryType` and `AccessionType` of the OpenAPI document list them.
- A paginated list returns `pagination` and `items`. `page` starts at 1. If `page` is after the last page, then the api returns status 200 with empty `items` and `hasNext` false, however large `page` is.
- A `sort` parameter has the form `{field}:{direction}`, where `direction` is `asc` or `desc`.
- Every response has an `X-Request-ID` header. If the request has an `X-Request-ID` header that is not empty, then the response repeats its value. Otherwise, the api generates a UUID. The 413 and 429 responses of the web server repeat only some values ([deployment.md](deployment.md#web-server)).
- The api allows cross-origin requests from every origin, with every method and every header.

Every JSON response includes `datasetVersion`, which identifies the dataset version ([build.md](build.md#dataset-version-information)) with four values: the name, the creation time, the model, and a digest of the complete version information. `GET /api/service-info` and the problem documents do not include `datasetVersion`. The exports are not JSON responses, so the exports name the dataset version with the name, the creation time, and the digest, in the `X-Dataset-Version` response header and in the header line of an accession list ([Exports](#exports)). `GET /api/dataset` returns the complete version information ([Dataset](#dataset)).

Counts change with every build of the dataset. To cite a result, record the `name`, `createdAt`, `model`, and `digest` of `datasetVersion`, the address of the api, and the date of access.

## Errors

Errors are RFC 7807 Problem Details (`application/problem+json`) with `type`, `title`, `status`, `detail`, `instance`, `timestamp` (ISO 8601, UTC), and `requestId` (the value of the `X-Request-ID` header). `detail` names the wrong parameter or value, and lists the values that the api accepts if the api accepts only a small set of values.

- `type` is `about:blank` for an error that the HTTP status describes, such as an unknown accession (404) or a request that does not match the OpenAPI document (422). `title` is the HTTP status phrase.
- `type` is `https://ddbj.nig.ac.jp/problems/<slug>` for an error that is specific to the api. If the DDBJ Search API has the same error of the condition DSL, then the api uses the slug of the DDBJ Search API, for example `unknown-field` and `unexpected-token`.

A client can predict the status from the OpenAPI document. For each operation, the OpenAPI document declares the statuses that the operation can return, and the slugs of its 400 and 503 responses. The OpenAPI document does not declare 404 for an unknown path, 405, or the statuses 413 and 429, which the web server returns.

| Status | When |
|---|---|
| 422 | The request does not match the OpenAPI document of the operation. Examples: a query parameter that the operation does not declare; a missing parameter; a value of the wrong type, out of range, outside an enumeration, or longer than the limit; a body that is not JSON; an unknown key or a missing key in a body; an empty `clauses`. |
| 400 | The request matches the OpenAPI document, but the request breaks a rule of the condition DSL or of the dataset. The slug of `type` names the rule. |
| 404 | The path does not exist, or the entry type, the accession, or the term does not exist. For a path under `/api` without an operation, `detail` points to the OpenAPI document. |
| 405 | The method is not allowed for the path. The `Allow` header lists the allowed methods. |
| 413 | The body is too large. The web server returns this status ([deployment.md](deployment.md#web-server)). |
| 429 | One client address has too many requests in progress, or too many exports in progress. The web server returns this status, with a `Retry-After` header ([deployment.md](deployment.md#web-server)). |
| 500 | The api failed unexpectedly. `detail` does not give the cause. |
| 503 | The api reached one of its limits ([Limits](#limits)). The slug of `type` names the limit. |

The api treats a parameter whose name differs only in letter case, such as `facetselfexclude`, as an unknown parameter. If a request repeats a parameter, then the api uses the last value.

In the OpenAPI document, the 400 response and the 503 response of each operation list the slugs that the operation can return, with the cause and the remedy of each slug. These descriptions come from one table in the api (`backend/src/bsllmner_viewer/api/problems.py`), so every operation describes a slug in the same words. The rules that cause the slugs are in [Condition DSL](#condition-dsl), [Aggregations](#aggregations), [Default elements](#default-elements), and [Limits](#limits).

An export reads the store before the export sends the first byte. If that read fails, then the response has an error status: 500, or one of the 503 statuses of [Limits](#limits). If the export fails after the response has started, then the api cannot change the status, so the api ends the response without completing it. In HTTP/1.1, the last chunk does not arrive, and a client that checks the end of the response sees an error. A client must treat a response that did not complete as an incomplete result. A response that completed has every matching entry.

## Limits

Each worker process of the api limits the size of a request and the resources that one request uses.

- A condition (`q`), a keyword, a search text (`query` of `GET /api/terms`), and a value of a clause have at most 4096 characters. A field name, an element, and a term ID have at most 256 characters. An accession has at most 64 characters.
- The api rejects a value that is too long with status 422, with two exceptions. If a `q` in a query string is too long, then the api rejects the request with status 400 and slug `unexpected-token`. If a named element is too long, then the api rejects the request with status 400 and slug `invalid-element`.
- If the condition that the parse, select, or keyword operation returns ([Parsing and changing a condition](#parsing-and-changing-a-condition)) would have more than 4096 characters, then the api rejects the request with status 400 and slug `unexpected-token`, even if the input is short enough.
- A condition nests groups at most 5 levels deep and has at most 512 nodes. The api rejects a deeper or larger condition with status 400 and slug `nest-depth-exceeded`.
- The limits of the numbers of keywords, clauses, and elements are in [Keywords](#keywords), [Parsing and changing a condition](#parsing-and-changing-a-condition), and [Default elements](#default-elements).
- A worker runs a limited number of requests that read the store at the same time, and each running request takes a slot of the worker. The requests that read the store are the entry list, the aggregations, the project statistics, the term search, and the child terms. A request without a free slot waits for up to 10 seconds. If no slot is free after that time, or if many requests wait already, then the api answers status 503 with slug `server-busy` and a `Retry-After` header. A client retries after the time in the `Retry-After` header.
- A worker runs at most 2 exports at the same time. An export waits, and gets an answer, in the same way as the other requests. An export has no limit on the number of entries.
- A request can read the store for at most 60 seconds. The time starts when the request gets a slot, and the time includes the work of the api between the queries of the request. When the time has passed, the api stops the running query and answers status 503 with slug `query-timeout`. The wait for a slot does not count. An export has this limit for each page of entries that the export reads, or for the first read of an accession list. The time that the client takes to read the response does not count.
- If a query needs more memory than a worker can use, or more temporary disk space, then the api stops the query and answers status 503 with slug `query-too-large`. A narrower condition needs less.

The numbers in this list are the defaults. [deployment.md](deployment.md#environment-variables) lists the variables that change them.

## Caching

A response changes only if the api serves another store, another version of its code, or other versions of the packages that the api uses. Therefore, a client can keep the responses that it gets, and ask the api whether the responses are still current.

- A GET response with status 200 has an `ETag` header and the header `Cache-Control: no-cache`. The exports and `GET /api/service-info` do not have these headers.
- To check a response that you keep, send the same request with its `ETag` value in the `If-None-Match` header. If the response is still current, then the api answers status 304 without a body. Otherwise, the api answers status 200 with the current response and its `ETag`. A browser sends `If-None-Match` automatically. A script of another origin can read the `ETag` header.
- An `ETag` is valid only for the same method, the same path, and the same query string. A request with the same parameters in another order is another request with another `ETag`.
- The web server can compress a response, and then marks the `ETag` as weak, for example `W/"0123abcd"`. The api accepts the value with and without `W/` in `If-None-Match`.
- The api answers status 304 without reading the store, so the request does not take a slot ([Limits](#limits)). Each worker also keeps recent responses in memory, and answers a repeated request without reading the store.

## Condition DSL

A condition is a single string, `q`. The queries for entries, aggregations, and exports all accept the same `q`. If `q` is omitted or empty, then the condition matches the whole population.

### Grammar

The grammar is the subset of the Lucene query syntax that the search DSL of the DDBJ Search API uses (the `/db-portal/*` endpoints). A condition string gives an abstract syntax tree (AST) of the same shape in both APIs.

- `field:value`, `field:"phrase"`, and `field:[a TO b]`
- keywords without a field: `hypoxia organoid` and `"breast cancer"`
- phrases in double or single quotes: `"breast cancer"` and `'breast cancer'`. Inside a phrase, a backslash and the character after the backslash mean that character, so `\"`, `\'`, and `\\` mean a double quote, a single quote, and a backslash.
- A single-quoted phrase ends at a single quote if white space, `)`, or the end of the condition comes right after the single quote. Inside the phrase, a single quote with another character right after it is part of the phrase, as in `'Alzheimer's disease'`. Any other single quote is part of a word, as in `'s`, `Alzheimer's`, `3'UTR`, and `5'`.
- `AND`, `OR`, and `NOT` (upper case), and grouping with `( )`. `AND`, `OR`, or `NOT` is an operator if whitespace, the end of the condition, or one of the characters `( ) [ ] { } " ' : ^ ~ * ? /` comes right after it, and otherwise is part of a word. For example, `NOT (a)` and `NOT(a)` are negations, and `NOTCH1` is one word.
- The JSON representation of the AST has the same shape as in the DDBJ Search API, and the `op` property tells the type of each node.

The compatibility with the DDBJ Search API covers the grammar and the shape of the AST. The set of fields and the evaluation of fields and keywords are specific to this API.

### Fields

| Kind | Example | Matches where |
|---|---|---|
| Annotation term | `disease:"MONDO:0007254"` | the field has the given term or one of its descendants |
| Annotation status | `disease_status:unmapped` | the field has a status under the given group |
| Assay | `library_strategy:ATAC-seq` | the experiment has the given `library_strategy`, which is one of the target assays of the dataset |
| Organism | `organism_id:9606` | the BioSample's organism has the given NCBI Taxonomy ID |
| Publication date | `date_published:[2015-01-01 TO 2020-12-31]` | the BioSample's publication date is in the range |
| BioProject | `bioproject:PRJNA123456` | the BioSample belongs to the given BioProject |

- A range with a start after its end is valid and matches nothing. The negation (`NOT`) of such a range matches the whole population.
- A clause on an annotation term field matches the term and its descendants through is-a and part-of relations ([data-model.md](data-model.md#term-hierarchy)).
- An `organism_id` value is a decimal number of ASCII digits with no sign and no leading zero, and is at most 2147483647. The api rejects any other value with status 400 and slug `invalid-value`.
- An annotation term value is a term ID in the form `PREFIX:ID`, such as `UBERON:0000955`. The api rejects a value in another form with status 400 and slug `invalid-value`, and `detail` points to `GET /api/terms`, which finds term IDs. A term ID in this form that the dataset does not have is valid and matches nothing.
- An annotation status value is one of the three status groups that [data-model.md](data-model.md#annotation-status) defines. The api rejects a single status, such as `mapped_exact`, with status 400 and slug `invalid-value`, and `detail` lists the groups. The entries and the exports give the status of each annotation. The count of a group is the `total` of an aggregation of `(<q>) AND <field>_status:<group>`.
- A `library_strategy` value must be spelled exactly as a target assay of `GET /api/dataset`. The api rejects any other value with status 400 and slug `invalid-value`, and `detail` lists the target assays.
- A date is a calendar date in the form `YYYY-MM-DD`. The api rejects a value in this form that is not a calendar date, such as `2020-13-45`, with status 400 and slug `invalid-date-format`. The api rejects a bound of a range in the same way if the bound is not a date in this form, such as `2020` in `[2020 TO 2021]`.
- `date_published` takes only a date or a range of dates. The api rejects a value of another form, such as `2020-1-1`, a quoted date, or `""`, with status 400 and slug `invalid-operator-for-field`.
- No other field takes a date or a range, and no field takes a wildcard. The api rejects a date or a range on another field, such as `bioproject:2020-01-01`, with status 400 and slug `invalid-operator-for-field`, and rejects a wildcard in a value, such as `disease:HIF-1*`, in the same way.
- The api rejects a clause with an empty value on a field other than `date_published`, such as `disease:""`, with status 400 and slug `missing-value`.
- The names of the annotation fields are the field names of the select configuration. `_status` is a suffix that follows a field name.
- The other fields use the field name of the DDBJ Search API if the DDBJ Search API has a field for the same concept.
- [data-model.md](data-model.md#condition-evaluation) defines how the api evaluates clauses against BioSamples and experiments.
- `GET /api/dataset` lists the fields of the dataset, each with its kind. The implementation decides the set of available fields.

### Keywords

A word or a phrase without a field is a keyword, such as `hypoxia organoid` or `"breast cancer"`. A keyword matches an entry whose searchable text ([data-model.md](data-model.md#condition-evaluation)) contains the keyword. Where the two APIs can be compared, matching follows the free-text search of the DDBJ Search API.

- A word is a sequence of letters, digits, and combining marks in any script, with at least one letter or digit. Every other character separates words, including white space such as the no-break space. For example, `β-catenin` has the two words `β` and `catenin`.
- The api compares letters case-insensitively, in the composed Unicode form (NFC). A decomposed `é` therefore matches a composed `é`. The final sigma `ς` matches the sigma `σ`.
- The api keeps accents, and does not fold letters further. For example, `Müller` and `Muller` are different words, and `ß` is not `ss`.
- Every word of a keyword must occur in the text, in any order and in any part of the text. For example, `breast cancer` matches a BioSample whose title says "breast" and whose disease is "cancer".
- A word matches whole words, so `cell` does not match `cellulose`. The last word of a keyword also matches the start of a word, so `organoid` matches `organoids`, and `H3K27` matches `H3K27ac`. A last word of one character matches only whole words.
- A word that contains symbols, such as `IL-4` or `CD4+`, matches its parts in sequence (`IL 4`) and its parts written together (`IL4`). In the same way, a word of the text that joins its parts with symbols, such as `MCF-7`, also matches its parts written together, so `MCF7` matches `MCF-7`.
- A quoted keyword is a phrase. The words of a phrase must occur in sequence within one value, such as one attribute value or the title.
- A phrase and other keywords are joined with `AND`, for example `"breast cancer" AND organoid`. As in the DDBJ Search API, the api rejects a phrase next to words without an operator, such as `"breast cancer" organoid` or `organoid 'breast cancer'`, with status 400 and slug `unexpected-token`. `POST /api/dsl/keyword` accepts such text as `keyword`, and returns a condition that joins the parts of the text with `AND`.
- A word with symbols and a phrase do not match the start of a word.
- A word in the form of an accession, written in ASCII letters and digits, matches the entry that has that accession, case-insensitively. The accession can be the accession of a BioSample, an SRA Experiment, an SRA Run, or a BioProject, for example `SAMN14864678` or `SRR11745799`. An SRA Experiment accession or an SRA Run accession matches only the entry of its experiment. A client finds the BioSample of an SRA Run by using the accession of the SRA Run as the keyword.
- The api returns an error for a wildcard, as the DDBJ Search API does, and for a keyword without a letter or a digit.

Unlike the DDBJ Search API, a keyword can appear anywhere in a condition, including under `OR` and `NOT`, and a condition can have several keywords. The api scans the searchable text once for each keyword, so a condition has at most 16 keywords and at most 64 words in all of its keywords. For this limit, a phrase counts as one word. The api rejects a condition over these limits with status 400 and slug `invalid-value`.

### Parsing and changing a condition

`GET /api/dsl/parse` converts a condition string to the AST. The response has the shape of the response of `/db-portal/parse` of the DDBJ Search API (`{ast}`), with four more properties: `q` (the condition in its canonical form), `labels`, `selected`, and `keyword`. The `selected` clauses are the clauses that the select operation treats as already in the condition ([From elements to conditions](#from-elements-to-conditions)).

`POST /api/dsl/select` and `POST /api/dsl/keyword` return the changed condition as `dsl`, with the same four properties. The body of `POST /api/dsl/select` has at most 512 clauses. The api has no operation that converts an AST to a string.

The api checks the clauses of `POST /api/dsl/select` with the rules of a condition. If a condition would reject the field or the value of a clause, then the clause gets the same slug as the same clause gets in `q`, for example `unknown-field` and `invalid-value`. The api uses `invalid-ast` only for a clause that is neither a value nor a range.

## Entries

An entry is a BioSample. `GET /api/entries/biosample` lists the BioSamples that match `q`, as the BioSample counting unit counts them ([data-model.md](data-model.md#counting)). Each item lists the experiments of the BioSample that match `q`. The annotations belong to the BioSample, and a BioSample can have several experiments, so the api lists an experiment in the item of its BioSample and not as an entry. The api always computes an entry list from `q` itself, and the `pagination.total` of an entry list is the count of the condition in the BioSample unit.

`GET /api/entries/biosample/{accession}` returns one BioSample with its original metadata, its annotations with evidence, its experiments, and its BioProjects. The BioSample does not have to be in the population, and its experiments show which of them are in the population. Each annotation with a term also has the clause on its field and term, so that a client can make a condition from the annotation. If the accession is not the accession of a BioSample, then the api answers status 404. To find the BioSample of another accession, a client uses the accession as a keyword in `q` ([Keywords](#keywords)).

The original metadata ([data-model.md](data-model.md#original-metadata)) is a list of items of three kinds: the description, the record, and the attributes. The list has the items in this order of their kinds, so that the items that describe the whole BioSample are first and the attributes are last. Evidence identifies an item by its position in the list, and tells whether the match is in the name or in the value of the item. [provenance.md](provenance.md#matching-strategies) defines the matching strategies.

- The api returns the description whether or not evidence points to it. The description consists of the title, the description paragraphs, the sample name, and the synonyms that the input entry has, with the names `Title`, `Description`, `Sample name`, and `Synonym`.
- The api returns an item of the record only if evidence of the BioSample points to the item. The name of an item of the record is a short name for its path in the input entry, such as `Owner` for `Owner.Name` and `Status` for `Status.when`. If a path has no short name, then the name of the item is the path itself.
- The name of an attribute is its attribute name. If bsllmner-mk2 lists the name of an attribute in its `filter_keys.json`, then the api returns the attribute only if evidence of the BioSample points to the attribute.

### Exports

The exports return every matching entry as TSV or as newline-delimited JSON (NDJSON, `application/x-ndjson`), and every matching accession of a type as plain text. Each line of the NDJSON is an item of the entry list. The entries are in the order of the entry list, and the accessions are in ascending order.

Every export has the response header `X-Dataset-Version: <name> <createdAt> <digest>`, for example `X-Dataset-Version: "bsllmner-mistral-all" 2026-10-03T21:29:30Z 0f8b06f33b9f2567`. `<name>` is the name of the dataset as a JSON string, in which a line break and every non-ASCII character are escaped, such as `\n` and `\u00e9`. Therefore, the value is always one line of ASCII. A browser of another origin can read the header.

An accession list starts with one header line, and then has one accession on each line. A client skips the header line, which starts with `#` and has the form `# bsllmner-viewer <type> accessions; q=<q>; dataset=<name> <createdAt> <digest>`, with the same dataset version as the response header. `<q>` is the condition as a JSON string, so the header line is always one line. If the condition is empty, then `<q>` is `""`. The TSV and the NDJSON have no header line for the dataset version, so that every line of the NDJSON is an item and the first line of the TSV names the columns.

In the TSV, a header line names the columns, and every row has as many cells as the header line. A cell with several values joins the values with `;`. After the entry columns, the TSV has one column for each annotation field. Each annotation in these columns is `value|termId|label|status`: always four parts in this order, with an empty part if the annotation has no value, no term, or no label. A client splits a cell on `;`, and then splits each annotation on `|`. Inside a part, the TSV percent-encodes the characters that delimit a cell: `%` as `%25`, `|` as `%7C`, `;` as `%3B`, tab as `%09`, carriage return as `%0D`, and line feed as `%0A`. Therefore, a value that contains these characters still gives the same four parts. In the other columns, the TSV replaces a tab or a line break in a value with a space. The TSV writes all other values without change, so a spreadsheet program can read a cell that starts with `=`, `+`, `-`, or `@` as a formula. A client that needs the exact values reads the NDJSON.

## Terms

`GET /api/terms/{termId}` returns one term of the dataset, with its direct parent terms. An empty `parents` means only that the term is a root in the dataset, and a root can have descendants. A client learns whether a term has descendants from the `descendantCount` of the term in a hit of `GET /api/terms`. A condition on a term with a `descendantCount` of 0 matches only the term itself ([data-model.md](data-model.md#term-hierarchy)).

The api derives the ontology of a term and the address of the term page from the prefix of the term ID. If the api does not know the prefix of a term, then the term has no address. Clients take the address from the api, and do not keep the addresses of ontologies themselves. The names of ontologies also come from the api: `GET /api/dataset` returns the name of each prefix of the terms of the dataset. If the api has no name for a prefix, then the name of the prefix is the prefix itself.

The term search (`GET /api/terms`) chooses its terms in the same population in which it counts the terms. If the search text is empty, then the term search chooses the terms that are assigned directly to the largest numbers of BioSamples in that population, in the same way as the api chooses the elements of an annotation term dimension ([Default elements](#default-elements)). If the search text is not empty, then every term of the field whose label, synonym, or ID contains the text is a candidate. The terms of a field are the terms that BioSamples of the whole population have in the field, together with the ancestors of these terms. Therefore, the candidates include a broad term that the term search counts only through its descendants, so that a user can find such a term and choose all of its descendants at one time.

The search returns the `limit` best candidates by ranking the candidates with three keys, in this order:

1. how the candidate matches the text: first a label or an ID equal to the text, then a synonym equal to the text, then a label or an ID that contains the text, and last a synonym that contains the text
2. the number of BioSamples in the population that have the candidate as a directly assigned term
3. the number of BioSamples in the whole dataset that have the candidate as a directly assigned term

The search returns the chosen hits in the order of how they match the text, and then in the order of `count`.

[Aggregations](#aggregations) specifies the child terms (`GET /api/terms/children`) of a term element.

## Aggregations

An aggregation counts the matches of `q` for each element along one or two dimensions, in a counting unit. A dimension is a DSL field of one of these kinds: term (an annotation field such as `disease`), assay (`library_strategy`), organism (`organism_id`), or date (`date_published`). The elements of a dimension are term IDs, target assays, NCBI Taxonomy IDs, or years, by the kind of the dimension. Each element has one clause for each dimension of the aggregation, and these clauses represent the element. For example, a bar of a distribution has the clause `disease:"MONDO:0007254"`, and a cell of a cross-tabulation has one clause for each axis.

The `total` of a distribution or a cross-tabulation is the count of its population in its counting unit. The api has no operation that returns only a count. To get the count of a condition in a unit, get the `total` of a distribution of the condition in that unit, with `facetSelfExclude` left false. For the BioSample unit, the count is also the `pagination.total` of the entry list.

The two dimensions of a cross-tabulation must be different fields. The dimension of a trend must not be `date_published`, because the trend already counts for each year. The api rejects a request that breaks either rule with status 400 and slug `invalid-dimension`.

The api rejects a `field`, `row`, or `col` that is not a field of the dataset with status 400 and slug `unknown-field`, as in a condition. The api rejects a field of the dataset that cannot be a dimension, such as `bioproject` or a status field (`<field>_status`), with slug `invalid-dimension`. The term search and the child terms accept only annotation fields, so they reject the other fields with `invalid-dimension`. `detail` lists the accepted fields.

The bucket of an element has `value`, `label`, and `count`, as a facet bucket of the DDBJ Search API has, and also the `clauses` of the element.

The counts of an annotation term element are the numbers of units that have the term or a descendant of the term. The counts of the statuses of an element count units, not annotations.

A distribution on an annotation term dimension also returns `withoutTerm`: the count of its population that has no term in the field. The elements count only the matches that have a term, so `withoutTerm` shows how much of the population the elements cannot count. For example, if most BioSamples of a condition state no disease, then the bars of the disease distribution cover only a small part of the condition.

An element of an annotation term dimension also tells where the term is in the ontology, so that a client can show the elements of a list as a tree. A term can have several parents in a list. `GET /api/terms/children` returns exactly the child terms that make `hasChildren` of the term true: the direct child terms that have a count above 0 in the population of the list, in the same counting unit. To get the children of a term element of a cross-tabulation, call `GET /api/terms/children` with the `populationQ` of the cross-tabulation ([Self-exclusion](#self-exclusion)) as `q`, so that the cross-tabulation and the child terms use the same population.

The project statistics (`GET /api/projects`) count the BioSamples and the SRA Experiments that match the population, not all of each BioProject. For example, if a BioProject has 100 BioSamples and 5 of them match the population, then the BioSample count of the BioProject is 5.

### Self-exclusion

By default, the population of an aggregation is `q`, as in the DDBJ Search API.

With `facetSelfExclude=true`, the api computes an aggregation without the conditions on the dimensions of the aggregation. The population of the aggregation is `q` without every top-level conjunct whose clauses are all on the dimensions of the aggregation. The api does not remove a conjunct that has a keyword. The remaining conditions apply as usual. Each response returns its population as `populationQ`.

The top-level conjuncts are the operands of the outermost `AND`, after nested `AND` groups are merged. For example, `a AND (b AND c)` has three top-level conjuncts.

The dimensions of an operation are its `field`, `row`, and `col`. The trend computes `total` without the conjuncts on `date_published`, and computes `series` also without the conjuncts on its `field` ([Trend](#trend)). The project statistics have the dimension `bioproject`. The term search and the child terms have their `field` as the dimension. If the term search has no `field`, then the term search counts each annotation field in the population without the conjuncts on that field.

With self-exclusion, every element of a dimension stays visible while one of its elements is selected, so that a user can compare the selection with the alternatives. The UI uses self-exclusion for the distributions, the cross-tabulations, the trend, and the counts that the condition panel and the term search show next to the values that a condition can take. The UI computes the project statistics with self-exclusion, so that the BioProjects in `q` stay in the list together with the other BioProjects that match the rest of `q`. The UI computes the entry list from `q` itself.

The counting unit that a user chooses in the UI applies to the distributions, the cross-tabulations, and the trend, and to the term searches that choose the elements of their dimensions. The condition panel, and the term search that adds a term to the condition, always count BioSamples, because the entries of a condition are BioSamples.

### Default elements

If a request does not name the elements of a dimension, then the api chooses the elements.

- For an annotation term dimension, the api chooses the terms that are assigned directly to the largest numbers of BioSamples in the population of the aggregation. The count of a term includes its descendants, but the choice does not include them. Therefore, the api does not choose a term that is only an ancestor of the assigned terms, such as the root of an ontology.
- For an assay dimension or an organism dimension, the api chooses the assays or the organisms of the largest numbers of BioSamples in the population of the aggregation, whatever the counting unit of the request is.
- For a date dimension, the api chooses every year in which the population of the aggregation has a match, in ascending order.
- In addition to the `limit` elements that the api chose, the api adds the elements that `q` names on the dimension in a top-level clause, or in a top-level disjunction of clauses, without `NOT`. Therefore, a selected element is present even if the element is not one of the most frequent elements.
- The api returns the term, assay, and organism elements that the api chose, and the elements that `q` names, in descending order of their counts in the counting unit of the request. The count of a term includes its descendants, and the count of a series of a trend is the sum of its counts over the years. Elements with the same count are in ascending order of the element, and organism IDs are compared as numbers. The elements of a distribution, the rows and the columns of a cross-tabulation, and the series of a trend all follow this order. If the request names elements with `elements`, `rowElements`, or `colElements`, then those elements keep the order of the request.
- A named element follows the value rules of a clause on the same dimension. A named term element is a term ID in the form `PREFIX:ID`, and a named assay element is a target assay of the dataset. A named organism element is an NCBI Taxonomy ID, and a named year element is a year from 1000 to 9999. A named organism element and a named year element are decimal numbers of ASCII digits with no sign and no leading zero, and an organism ID is at most 2147483647. The api rejects any other element with status 400 and slug `invalid-element`, so an element that gives status 400 as a clause also gives status 400 as a named element. A request names at most 100 elements of a dimension, and the api rejects a request with more elements with status 400 and slug `too-many-elements`. The `limit` of a cross-tabulation is at most 100, and the api rejects a larger `limit` with status 422.

### Trend

A trend counts the condition for each publication year of the BioSamples. A trend returns every year from the first year to the last year in which its population has a match, with a count of 0 for a year without a match. With self-exclusion, the population of these counts is `q` without the conjuncts on `date_published`.

If a request names a dimension, then the trend also counts each element of the dimension for each year. With self-exclusion, the population of these counts also excludes the conjuncts on that dimension.

The trend also returns `allEntries`: the count of the whole population for each year that the trend returns, in the same counting unit. Neither `q` nor self-exclusion applies to these counts, so that a client can compare the condition with the whole dataset.

`yearFrom` and `yearTo` limit the years that a trend returns, and do not change the population, the counts, or the default elements. `firstYear` and `lastYear` are the first year and the last year in which the populations of the trend have a match, whether or not the request limits the years, so that a client can offer the years for the user to choose from. If `yearFrom` is after `yearTo`, then the trend returns no years, in the same way that a reversed date range matches nothing in the DDBJ Search API.

### Expected counts in cross-tabulations

For each cell of a cross-tabulation, the api compares the count of the cell with the count that the cell would have if the two dimensions were independent. The api returns the expected count, the ratio to the expected count, and the adjusted standardized residual, in the selected counting unit. In the formulas, `N` is the count of the aggregation population, `R` is the count of the row, `C` is the count of the column, and `O` is the count of the cell.

- expected count `E = R × C / N`, or null when `N` is zero
- ratio to the expected count `O / E`, or null when `E` is null or zero
- adjusted standardized residual `r = (O − E) / sqrt(E × (1 − R / N) × (1 − C / N))`, or null when the denominator is zero

The count of a row or a column is the count of the matches of the row or the column, not the sum of the cell counts.

The ratio and the residual answer different questions. The ratio is the size of the difference: `2` means twice the expected count, and `0.5` means half of it. The residual tells whether chance can explain the difference, and the residual grows with the population. In a population of millions, a cell whose count is 1% above its expected count can have a residual far above 2. Therefore, the api classifies a cell only if both its ratio and its residual pass a threshold.

The api classifies a cell with `E ≥ 5` as follows, and does not classify a cell with `E < 5`.

| Class | Condition |
|---|---|
| Gap | `O = 0` |
| Under-represented | `O > 0`, `O / E ≤ 1/2`, and `r ≤ −2` |
| Over-represented | `O / E ≥ 2` and `r ≥ 2` |

The thresholds are fixed. Rows and columns overlap, and BioProject counts are counts of distinct BioProjects. Therefore, `E` and `r` describe how far a cell is from independence, and `E` and `r` are not a statistical test.

### Invariant

For every element of an aggregation, the count of the element equals the count of `q'` combined with the clauses of the element by `AND`, in the same counting unit, where `q'` is the population of the aggregation.

### From elements to conditions

An element with one clause is a bar of a distribution, or a point of the trend of the condition. If a user selects such an element in the UI, then the UI toggles the clause in `q`:

- The api treats these clauses as already in `q`: the top-level clauses, and the clauses of a top-level disjunction of clauses on one field, outside any `NOT`. The api returns these clauses as `selected` in the responses of parse, select, and keyword.
- If the clause is not in `selected`, and `q` has a top-level conjunct on the same field without `NOT` that is a clause or a disjunction of clauses, then the new clause is joined with `OR` to the first such conjunct.
- If the clause is not in `selected`, and `q` has no such conjunct, then the new clause is added to `q` as a new top-level conjunct with `AND`.
- If all clauses of the element are in `selected`, then selecting the element removes the clauses from every top-level conjunct that holds them, and removes every conjunct that becomes empty.

For example, selecting `disease:A`, then `library_strategy:ATAC-seq`, and then `disease:B` produces `(disease:A OR disease:B) AND library_strategy:ATAC-seq`.

An element with two clauses is a cell of a cross-tabulation, or a point of the trend of an element. If a user selects such an element in the UI, then the UI narrows the condition to the element. The new condition is the population of the aggregation combined with both clauses by `AND`. The count of the new condition equals the count of the element, in the same counting unit.

For example, with `q` equal to `library_strategy:ChIP-Seq`, selecting the cell of `cell_line:A` and `library_strategy:RNA-Seq` in a cross-tabulation of the two fields produces `cell_line:A AND library_strategy:RNA-Seq`.

`POST /api/dsl/select` performs both operations for clients, so that the UI and other clients derive the same condition from the same selection.

## Dataset

`GET /api/dataset` describes the dataset of the store: its complete version information ([build.md](build.md#dataset-version-information)), its fields with their kinds ([Fields](#fields)), its target assays, the names of the prefixes of its terms ([Terms](#terms)), and the counts of its whole population.

The counts of the whole population are the BioSample counts for each target assay, for each organism, and for each annotation field. Because build computes these counts, the counts stay the same for a store, and a client can show the counts without an aggregation request. The count of an assay or an organism equals the count of its element in a distribution with an empty `q` in the BioSample unit. The count of a field is the number of BioSamples with a term in the field, so the count equals the count of `<field>_status:mapped`.

## Service information

`GET /api/service-info` is the endpoint for health monitoring.

The api starts only with a store that the api can open and whose schema version the code of the api reads. If the store file is missing, is not a DuckDB file, or has another schema version, then the process stops at startup, and the endpoint does not answer. While the api runs, the endpoint returns status 200, and the `store` property of the response is `unavailable` if the api cannot query the store or if the store file changed after the api opened it. Therefore, the endpoint reports a store file that someone overwrote or truncated while the api served it.

## URLs

The UI has three pages:

- `/`: the top page
- `/entries`: the page that shows the entries and the aggregations of a condition
- `/entries/{accession}`: the page of one BioSample

Only `q` and the view parameters (the view tab, the counting unit, the axes of a cross-tabulation, and similar parameters) represent the state of `/entries`, and all of them are part of the URL. The `q` in a URL is the same string as the `q` of the API. With the same store version, the same URL gives the same result.

Every count, table, and chart that the UI shows comes from one API query with the `q` and the view parameters of the UI state. One view can show the results of several queries. The exports use the same `q`. If you call the API with the `q` and the view parameters of a UI state, then the API returns the result that the UI shows in that state.

## Compatibility

- The version of the OpenAPI document identifies the version of the contract.
- Before version 1.0.0, any version can change the contract incompatibly.
- From version 1.0.0, adding endpoints, parameters, or response properties is a compatible change. A client ignores the properties that it does not know. Removing or renaming anything, or changing its meaning, is an incompatible change, and increments the major version.
