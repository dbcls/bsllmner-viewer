# Build

This document specifies what build reads, what it validates, and how it produces a store. The meaning of the stored data is defined in [data-model.md](data-model.md).

## Inputs

build reads three kinds of input: a manifest, runs, and reference data.

### Manifest

A manifest is the YAML file that defines a dataset and that every build operation reads. It contains:

- the dataset name,
- the target assays, as a list of SRA `library_strategy` values,
- the list of runs in order, each run given as a result file, an input file, a select configuration, and the bsllmner-mk2 version used, and
- the location and snapshot date of each reference data source, with the ontology files listed per ontology.

Paths in a manifest are relative to the manifest's directory. The format is defined by the manifest model in the build package.

### Runs

A run is one execution of `bsllmner2_select` of bsllmner-mk2.

| File | Format |
|---|---|
| Result | SelectResult JSON, as specified in the bsllmner-mk2 data format documentation |
| Input | BioSample JSONL given to the execution: one NCBI BioSample entry per line as exported from BioSample XML (`Ids`, `Description`, `Attributes`, `submission_date`, `publication_date`, `last_update`), either wrapped as `{"BioSample": {...}, "accession": ...}` or with the same members at the top level next to `accession` |
| Select configuration | The select configuration JSON given to the execution, mapping each field to an ontology file |

From an input entry, build takes the organism (`Description.Organism`), the title, the publication date (`publication_date`), the description (`Description.Comment.Paragraph`, `Description.SampleName`, and `Description.Synonym`), the attributes (`Attributes.Attribute`), and the other members of the entry as its record, without the contacts of the owner (`Owner.Contacts`). A paragraph is a string or a list of strings, and a synonym is an object or a list of objects that holds the synonym as `content`. Of the record, build keeps each string value that evidence points to, together with its path in the entry, such as `Owner.Name`. build finds this evidence while it ingests the run ([provenance.md](provenance.md#when-build-finds-evidence)).

The store keeps every attribute of an input entry that has a value. A number is stored as its text, and an attribute without `content` or with a null `content` has no value. The derived BioSample leaves out some attributes that record how the BioSample was submitted and archived, such as `INSDC status`, `gap_accession`, and `GEO Accession`. The candidates are the attribute names that bsllmner-mk2 lists in its `filter_keys.json`, and the build package holds a copy of them. Derivation leaves out a candidate only if no evidence of any BioSample points to an attribute of that name ([provenance.md](provenance.md)). Leaving the attributes out therefore removes no evidence. A candidate that evidence points to in one BioSample stays in every BioSample. The api does not return the attributes that are left out, and keywords do not match their values.

The publication date is the only date that build takes, because it is the only date that means the same for every BioSample. Every entry has `publication_date`, whether NCBI, EBI, or DDBJ registered the BioSample. `submission_date` is absent from DDBJ entries (`SAMD`), and in EBI entries (`SAME`) it is usually later than the publication date. build stores the date in UTC, as the DDBJ Search API does.

build treats a publication date as unknown when it cannot be the day on which the BioSample became public. A date after the day on which the run started (`run_metadata.start_time`) is a planned release date, because the run analyzed the BioSample after it had become public. A date before 2005-01-01 is a placeholder, such as 2000-01-01, because the sequencing assays of a dataset produced no data that early. A BioSample with an unknown date does not match a clause on the date, so it matches the negation of the clause. It is not counted in trends. The DDBJ Search API keeps such dates, so a condition on the date can select different BioSamples in the two APIs.

### Reference data

| Source | Used for |
|---|---|
| Ontology files (OWL in RDF/XML, or OBO), listed per ontology in the manifest | Term labels, synonyms, and parent–child relations. Every file of an ontology adds terms and relations. If two files define the same term, then the label comes from the earlier file. The files are in the order of the ontologies in the manifest, and then in the order of the files of each ontology |
| SRA experiment JSONL (ddbj-search-converter) | `library_strategy` of experiments |
| DBLink DuckDB file (ddbj-search-converter, table `dbxref`) | BioSample–SRA Experiment, SRA Experiment–SRA Run, and BioSample–BioProject relations |
| BioProject JSONL (ddbj-search-converter) | BioProject titles |
| ChIP-Atlas experiment list | Experiments processed by ChIP-Atlas and their genome assemblies, for external links |

The ontology files used by the runs themselves (the subsets referenced by the select configurations) define the terms an annotation can carry but do not contain the term hierarchy. The manifest therefore lists, for each ontology, those subsets together with a complete release of the ontology that carries the parent–child relations.

## Validation

Build operations validate their inputs before ingesting anything and stop on the first violation. The error names the file, and it names the line when the file has lines. Later stages assume that the following hold.

- Every run in the dataset has the same `run_metadata.model`.
- Every run has `run_metadata.status` equal to `completed`.
- Ontology names are unique.
- No run is ingested twice. Run names are unique, two runs do not have the same result file, and an append operation rejects a run that is already in the store.
- An `accession` occurs once in the result of a run.
- Every non-empty line of an input file is a JSON object with an `accession`.
- The `taxonomy_id` of an input entry is absent, null, empty, or an integer from 1 to 2147483647. The integer is a JSON number or a string of ASCII digits.
- The `run_metadata` of a result has `run_name`, `model`, and `status`.
- Every entry of a run result has an `accession` that appears in the run's input file.

## Reading annotations

The status and term of each annotation are read from a SelectResult entry. Statuses are defined in [data-model.md](data-model.md).

The extracted values of a field are the string in `extract.extracted[field]`, or each string element if it is an array. An empty string is not a value, and an array that holds the same string several times gives the value once, at the position of its first occurrence. For example, an array with 400 copies of `GFP-TF or GFP only as control` and 3 other strings gives 4 values. An extracted value is **mapped** when `results[field]` has an element whose `value` equals the extracted value and whose `term_id` is not null; the term is taken from that element.

| Status | Condition |
|---|---|
| `extraction_failed` | `extract.extracted` is null or is not an object. Applies to every field of the BioSample. |
| `not_stated` | `extract.extracted[field]` is null, absent, or contains no string. |
| `mapped_exact` | The value is mapped, and `select_timings[field][value]` does not exist. |
| `mapped_selected` | The value is mapped, and `select_timings[field][value]` exists. |
| `unmapped_rejected` | The value is not mapped, and `search_results[field][value]` or `text2term_results[field][value]` is non-empty. |
| `unmapped_no_candidate` | The value is not mapped, and both `search_results[field][value]` and `text2term_results[field][value]` are empty or absent. |

`exact_match` and `reasoning` in `results[field]` do not identify how a term was determined. A term selected by the LLM carries the `exact_match` value of the selected candidate, and carries the candidate's `reasoning` when the LLM returns none.

## BioSamples in multiple runs

A BioSample can appear in more than one run when the dataset combines sources whose BioSamples overlap. For example, a BioSample with both ChIP-Seq and RNA-Seq experiments is analyzed in a run of ChIP-Atlas and in a run of RNA-Seq, so that the results of each source are complete on their own.

The store keeps the annotations of exactly one run per BioSample: of the runs that have the BioSample, the run that comes first in the list of runs of the manifest. All annotations, attributes, and the date of the BioSample are taken from that run; values from different runs are never combined. The selection depends only on the order of the list of runs, not on the contents of the runs or on the order of ingestion. An append adds runs after every existing run, so it never changes a BioSample that is already in the store.

## Operations

Every operation leaves its input store unchanged and writes a new store file. If a build stops with an error, then it removes the file that it was writing. If verification finds a problem, then the build still writes the store and records the problems in it. If the build process is killed, then `<out>.partial` remains, and the next build with the same output path removes it. Append and refresh accept only a store that has the current schema version. If the store has another schema version, then they stop and ask for a full build.

| Operation | Input | Effect |
|---|---|---|
| Full build | Manifest | Ingests all runs and reference data, and derives query-ready data |
| Append | Store with the current schema version, manifest with additional runs added to the end of the list of runs | Ingests the runs not yet in the store, reads the reference data of the manifest, applies the BioSample selection over all runs, and re-derives query-ready data |
| Reference refresh | Store with the current schema version, manifest with updated reference data or target assays | Replaces reference data and re-derives query-ready data, without re-ingesting runs |

Derived data comprises everything computable from runs and reference data: the evidence that build finds with the names of terms, the attributes that each BioSample shows, the transitive closure of the term hierarchy, the population, the searchable text of BioSamples, auxiliary data for aggregation, and the counts of the whole population that the api returns from its dataset endpoint (see [api.md](api.md#counts-of-the-whole-population)). Every operation recomputes derived data from scratch rather than patching it.

A full build of runs `R1..Rn` and a full build of `R1..Rk` followed by an append of `Rk+1..Rn` produce stores with identical contents.

## Verification and publication

Before publication, build verifies the new store:

- the population is not empty, and
- the BioSample–BioProject relations and the SRA Experiment–SRA Run relations are not empty.

Publication switches the api to a verified store file (see [architecture.md](architecture.md)).

## Dataset version information

A store holds the following version information. The api returns all of it from its dataset endpoint, and every response and export carries an identifier of the store: the dataset name, the creation time, the model, and a digest of the complete version information.

- Dataset name and store creation time
- Model
- bsllmner-mk2 version of each run
- Checksums of the select configuration of each run and of every ontology file
- Snapshot date of each reference data source
- Target assays
