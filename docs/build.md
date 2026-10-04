# Build

This document specifies what build reads, what build validates, and how build produces a store. [data-model.md](data-model.md) defines the meaning of the stored data. [operations.md](operations.md) gives the commands that run build.

## Inputs

The inputs of build are of three kinds: a manifest, runs, and reference data.

### Manifest

A manifest is a YAML file that defines a dataset. Every build operation ([Operations](#operations)) reads a manifest. A manifest contains these items:

- the name of the dataset
- the target assays, as a list of SRA `library_strategy` values
- the list of runs, in order. For each run, the manifest gives a result file, an input file, a select configuration, and the version of bsllmner-mk2 that the run used.
- the location and the snapshot date of each source of reference data. For the ontologies, the manifest lists the files of each ontology.

A path in a manifest is relative to the directory of the manifest. The manifest model in the build package defines the format. A manifest looks like this:

```yaml
name: bsllmner-mistral
target_assays: [RNA-Seq, ChIP-Seq, ATAC-seq]
runs:
  - name: chipatlas_hg38_part1
    result: ro-crate/results/select_chipatlas_hg38_part1.json
    input: ro-crate/inputs/chipatlas_hg38/bs_entries_chipatlas_hg38_part1.jsonl
    select_config: ro-crate/config/select-config-hg38.json
    mk2_version: 5a5744e
reference:
  ontologies:
    - name: MONDO
      files: [ro-crate/ontology/mondo_human_subset.owl, ontology/mondo.obo]
      snapshot_date: "2026-09-17"
  sra_experiments:
    path: converter/sra/jsonl/20260507
    snapshot_date: "2026-05-07"
  dblink:
    path: converter/dblink/dblink.duckdb
    snapshot_date: "2026-06-25"
  bioprojects:
    path: converter/bioproject/jsonl/20260423
    snapshot_date: "2026-04-23"
  chip_atlas:
    path: reference/experimentList.tab
    snapshot_date: "2026-09-17"
```

### Runs

A run is one execution of `bsllmner2_select` of bsllmner-mk2. A run has three files:

| File | Format |
|---|---|
| Result | SelectResult JSON, as specified in the bsllmner-mk2 data format documentation |
| Input | The BioSample JSONL that the execution read. Each line is one NCBI BioSample entry, in the form of an export from BioSample XML (`Ids`, `Description`, `Attributes`, `submission_date`, `publication_date`, `last_update`). An entry is either wrapped as `{"BioSample": {...}, "accession": ...}`, or has the same members at the top level next to `accession` |
| Select configuration | The select configuration JSON that the execution read, which maps each field to an ontology file |

From an input entry, build takes these items:

- the organism (`Description.Organism`)
- the title
- the publication date (`publication_date`, see [data-model.md](data-model.md#publication-date))
- the description (`Description.Comment.Paragraph`, `Description.SampleName`, and `Description.Synonym`)
- the attributes (`Attributes.Attribute`)
- the other members of the entry, as the record of the entry, without the contacts of the owner (`Owner.Contacts`)

A paragraph is a string or a list of strings. A synonym is an object or a list of objects, and each object holds the synonym in `content`.

From the record, build keeps each value that evidence points to, together with the path of the value in the entry, such as `Owner.Name`. While build ingests the run, build finds this evidence ([provenance.md](provenance.md#when-build-finds-evidence)).

The store keeps every attribute of an input entry that has a value, and keeps a number as text. An attribute without `content`, or with a null `content`, has no value.

When build computes the derived data ([Operations](#operations)), build removes from every BioSample some attributes that record how the BioSample was submitted and archived ([data-model.md](data-model.md#original-metadata)). The names of these attributes are the names that bsllmner-mk2 lists in its `filter_keys.json`, and the build package holds a copy of the list. However, build removes the attributes of a name only if no evidence of any BioSample points to an attribute of that name. Therefore, build removes no attribute that evidence points to. If evidence of one BioSample points to an attribute of a name, then build keeps the attributes of that name in every BioSample. The api does not return a removed attribute, and a keyword does not match the value of a removed attribute.

### Reference data

| Source | Used for |
|---|---|
| Ontology files: Web Ontology Language (OWL) files in RDF/XML, or OBO files. The manifest lists the files of each ontology | Term labels, synonyms, and parent–child relations |
| SRA Experiment JSONL (ddbj-search-converter) | `library_strategy` of experiments |
| DBLink DuckDB file (ddbj-search-converter, table `dbxref`) | BioSample–SRA Experiment, SRA Experiment–SRA Run, and BioSample–BioProject relations |
| BioProject JSONL (ddbj-search-converter) | BioProject titles |
| ChIP-Atlas experiment list | SRA Experiments that ChIP-Atlas processed, and their genome assemblies, for external links |

If the source of SRA Experiments or of BioProjects is a directory, then build reads every `*.jsonl` file under the directory. For SRA Experiments, build reads only the files whose names contain `experiment`. The ChIP-Atlas experiment list is the `experimentList.tab` file that ChIP-Atlas publishes.

The runs use subsets of the ontologies, and the select configurations refer to these subsets. The subsets define the terms that an annotation can have, but the subsets do not contain the term hierarchy. Therefore, for each ontology, the manifest lists the subsets and also a complete release of the ontology, which contains the parent–child relations.

From every file of an ontology, build reads the terms and the relations. If two files define the same term, then build takes the label from the earlier file. The order of the files is the order of the ontologies in the manifest, and then the order of the files of each ontology. [data-model.md](data-model.md#term-hierarchy) specifies which relations build reads as parent relations, and which terms build skips.

Of the terms in an ontology file, build reads only the terms whose IDs are compact URIs (CURIEs) of the form `PREFIX:local`, after build converts each OBO address into a CURIE. For example, build converts `http://purl.obolibrary.org/obo/CL_0000000` into `CL:0000000`. If the address of a term or a parent gives no prefix, then build does not read the term or the parent. For example, MONDO refers to a gene as `http://identifiers.org/hgnc/5032`. This address gives no prefix, so build does not read that gene.

After the runs, build reads the reference data. In two cases, build stops with an error that names the file or the experiment:

- The reference data has a file that build cannot read.
- The SRA Experiment data gives more than one library strategy to an experiment of the dataset.

If the SRA Experiment data has the same row twice, then build treats the two rows as one row.

## Validation

Before a build operation ingests anything, the operation validates its inputs, and stops at the first violation. The error names the file, the run, or the field that violates the rule, and also names the line if the file has lines. The later steps of build assume that the following rules are true:

- Every run of the dataset has the same `run_metadata.model`.
- Every run has `run_metadata.status` equal to `completed`.
- The names of the ontologies are unique.
- Every path of the reference data in the manifest exists.
- No run is ingested twice. The names of the runs are unique, and no two runs have the same result file.
- A field is multi-valued (`"value_type": "array"` in the select configuration) either in every run that has the field, or in no run.
- No `accession` occurs more than once in the result of a run.
- Every non-empty line of an input file is a JSON object with an `accession`.
- The `taxonomy_id` of an input entry is absent, null, empty, or an integer from 1 to 2147483647, written as a JSON number or as a string of ASCII digits.
- The `run_metadata` of a result has `run_name`, `model`, and `status`.
- The `accession` of every entry of a run result appears in the input file of the run.

## Reading annotations

For each annotation, build reads the status and the term from an entry of a SelectResult. [data-model.md](data-model.md#annotation-status) defines the statuses.

For each field, build reads the extracted values from `extract.extracted[field]`. If `extract.extracted[field]` is a string, then the string is the extracted value. If `extract.extracted[field]` is an array, then each string element of the array is an extracted value. An empty string is not a value. If an array holds the same string several times, then the string gives one value, at the position of its first occurrence. For example, an array with 400 copies of the string `GFP-TF or GFP only as control` and 3 other strings gives 4 values.

An extracted value is mapped if `results[field]` has an element that meets two conditions: the `value` of the element equals the extracted value, and the `term_id` of the element is not null. In that case, build takes the term from that element.

| Status | Condition |
|---|---|
| `extraction_failed` | `extract.extracted` is null or is not an object. This status applies to every field of the BioSample. |
| `not_stated` | `extract.extracted[field]` is null, absent, or contains no string. |
| `mapped_exact` | The value is mapped, and `select_timings[field][value]` does not exist. |
| `mapped_selected` | The value is mapped, and `select_timings[field][value]` exists. |
| `unmapped_rejected` | The value is not mapped, and `search_results[field][value]` or `text2term_results[field][value]` is non-empty. |
| `unmapped_no_candidate` | The value is not mapped, and both `search_results[field][value]` and `text2term_results[field][value]` are empty or absent. |

The values `exact_match` and `reasoning` in `results[field]` do not show how a term was determined. A term that the LLM selected has the `exact_match` value of the selected candidate. If the LLM returns no reasoning, then the term also has the `reasoning` of the candidate.

## BioSamples in multiple runs

A BioSample can appear in more than one run if the dataset combines sources of BioSamples that overlap. For example, assume that a BioSample has both ChIP-Seq experiments and RNA-Seq experiments. Then both a run of the ChIP-Atlas BioSamples and a run of the RNA-Seq BioSamples analyze the BioSample, so that the results of each source are complete without the other source.

The store keeps the annotations of exactly one run for each BioSample. Of the runs that have the BioSample, build uses the run that is first in the list of runs of the manifest. From that run, build takes all annotations, all attributes, and the date of the BioSample, and build never combines values from different runs. The choice of the run depends only on the order of the list of runs, not on the contents of the runs or on the order of ingestion. An append adds runs after every existing run, so an append never changes a BioSample that is already in the store.

## Operations

Every build operation writes a new store file, and does not change any store that the operation reads.

| Operation | Input | Effect |
|---|---|---|
| Full build | A manifest | Ingests all runs and all reference data, and computes the derived data |
| Append | A store with the current schema version, and a manifest that lists the runs of the store first, in the same order, and then at least one more run | Ingests the runs that are not yet in the store, reads the reference data of the manifest, chooses the run of each BioSample again over all runs, and computes the derived data again |
| Reference refresh | A store with the current schema version, and a manifest that lists exactly the runs of the store, in the same order, with updated reference data or updated target assays | Replaces the reference data, and computes the derived data again without ingesting the runs again |

The derived data consists of everything that build can compute from the runs and the reference data:

- the evidence that build finds with the names of terms ([provenance.md](provenance.md#ontology_synonym))
- the attributes that each BioSample shows
- the transitive closure of the term hierarchy
- the population
- the searchable text of the BioSamples
- auxiliary data for aggregations
- the counts of the whole population that the api returns from its dataset endpoint ([api.md](api.md#dataset))

Every operation computes the derived data again from the beginning, and does not update the derived data in place.

Compare two ways to build a store from the runs `R1..Rn`: a full build of `R1..Rn`, and a full build of `R1..Rk` with a later append of `Rk+1..Rn`. The two stores have identical contents, except for the time at which each store was created and the times at which the runs were ingested.

An append and a reference refresh accept only a store that has the current schema version. If the store has another schema version, then the operation stops, and the error asks you to run a full build.

If an operation stops with an error, then the operation removes the file that the operation was writing. If the build process is killed, then the file `<out>.partial` remains, where `<out>` is the output path. The next build with the same output path removes `<out>.partial`. If verification finds problems, then the operation still writes the store, and records the problems in the store.

## Verification

Before publication, build verifies the following in the new store:

- every table of the store schema exists,
- no BioSample is stored twice,
- the population is not empty, and
- the BioSample–BioProject relations and the SRA Experiment–SRA Run relations are not empty.

To publish a store, you switch the api to a verified store file ([architecture.md](architecture.md#a-published-store-is-never-modified)).

## Dataset version information

A store holds the following version information:

- the dataset name and the store creation time
- the model
- the bsllmner-mk2 version of each run
- the checksums of the select configuration of each run and of every ontology file
- the snapshot date of each source of reference data
- the target assays

The api returns all of this information from its dataset endpoint. The JSON responses of the api have an identifier of the version, which consists of the dataset name, the creation time, the model, and a digest of the complete version information. [api.md](api.md#conventions) lists the responses that do not have the identifier, and describes how the exports name the version.
