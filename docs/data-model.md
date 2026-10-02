# Data Model

This document defines what a store represents: which BioSamples and experiments form the population, how annotations are classified, how conditions are evaluated, and how matches are counted. Input formats and build operations are specified in [build.md](build.md).

## Dataset

A **dataset** is a set of runs analyzed with a single model, together with reference data and a list of target assays. A store file represents one version of one dataset.

Target assays are a list of SRA `library_strategy` values.

## Population

The **population** is the set of BioSamples, each together with an SRA experiment linked to it, that satisfy both of the following:

- The BioSample was analyzed by a run in the dataset.
- The experiment's `library_strategy` is one of the target assays.

A BioSample linked to several experiments of target assays is in the population once with each of them.

A BioSample analyzed by a run but linked to no experiment of a target assay is kept in the store and is absent from the population. Adding an assay to the target assays makes such BioSamples part of the population without re-ingesting runs.

## Entities

| Entity | Attributes | Relationships |
|---|---|---|
| BioSample | Accession, organism, title, creation date, original attributes | N:M with SRA Experiment, N:M with BioProject |
| SRA Experiment | Accession, `library_strategy` | 1:N with SRA Run |
| SRA Run | Accession | N:1 with SRA Experiment |
| BioProject | Accession, title | N:M with BioSample |
| Annotation | Field, extracted value, status, term | N:1 with BioSample |
| Evidence | Attribute name, character range, method | N:1 with Annotation |
| Ontology term | ID, label, synonyms, parent terms | Parent–child relations form a DAG |

Annotation fields are the fields of the bsllmner-mk2 select configuration used by the runs. A field holds either a single value or multiple values.

## Annotation status

Annotations are LLM-derived and may be wrong. Every annotation carries a status. Statuses form two levels: three groups, each with two statuses.

| Group | Status | Scope | Meaning |
|---|---|---|---|
| `no_value` | `not_stated` | Field | No value was extracted for the field. |
| | `extraction_failed` | BioSample | The LLM output for the BioSample could not be interpreted, so no field has a value. |
| `unmapped` | `unmapped_no_candidate` | Extracted value | No ontology term was a candidate for the value. |
| | `unmapped_rejected` | Extracted value | Candidate terms existed, but none was adopted. |
| `mapped` | `mapped_exact` | Extracted value | The term was determined automatically by an exact match against an ontology label or synonym, without an LLM call. |
| | `mapped_selected` | Extracted value | The term was selected by the LLM from the candidate terms. |

- A group matches every status under it, in the same way that a term matches its descendants.
- `no_value` means that nothing was extracted; it does not mean the sample lacks the property. A sample without an extracted drug is not necessarily untreated.
- `unmapped_no_candidate` indicates that the ontology has no label or synonym resembling the value. `unmapped_rejected` indicates that similar terms exist but none was adopted, typically because the LLM judged them inconsistent with the BioSample metadata.
- In a multi-valued field, a BioSample can hold several statuses at once.

## Evidence

Evidence locates an extracted value in the original attributes of its BioSample, including the title, so that users can check what an annotation was derived from.

- Each piece of evidence identifies an attribute, the character range of the match within the attribute value, and the method that produced it. Evidence from different methods can coexist for one extracted value.
- The `string_match` method finds the extracted value in attribute values after Unicode NFKC normalization and case folding. Whitespace, hyphens, underscores, slashes, and periods are treated as interchangeable separators that may also be absent, so `MCF7` matches `MCF-7`.
- Evidence is best-effort. An extracted value without evidence may still have been derived from the attributes, for example when the LLM changed its spelling.

## Term hierarchy

A condition on a term matches the term itself and all of its descendants.

- Descendants are resolved over every parent–child relation of the ontology DAG. A term with several parents is a descendant of each of them.
- A term of an ontology without hierarchy matches only itself.
- An annotated term that is absent from the reference ontology still matches by its ID. It has no descendants, and its label is the one recorded in the run result.

## Condition evaluation

A condition is evaluated on a BioSample of the population together with one of its experiments, once for each experiment.

- Clauses on annotations, organism, creation date, and BioProject are evaluated against the BioSample.
- Clauses on `library_strategy` are evaluated against the experiment.
- Keywords are evaluated against the searchable text of the BioSample. A word in the form of an accession is evaluated against the accessions of the BioSample, its BioProjects, the experiment, and the experiment's runs.
- A clause on a field is true when at least one value of that field satisfies it. A clause on a field-level or BioSample-level status (`not_stated`, `extraction_failed`) is evaluated against the field as a whole.

Because each evaluation sees the assay of a single experiment, a condition that requires two different assays matches nothing, even for a BioSample that has experiments of both. Assays are compared by counting per assay under the same annotation conditions.

The **searchable text** of a BioSample consists of its title, its organism name, the values of its original attributes, and the extracted values and term labels of its annotations. Attribute names are not part of it, because nearly every BioSample has the same names. How keywords match the text is specified in [api.md](api.md).

## Counting

A condition's matches are counted in three units.

| Unit | Count |
|---|---|
| BioSample | Distinct BioSamples that match together with at least one of their experiments |
| SRA Experiment | Distinct experiments that match together with their BioSample |
| BioProject | Distinct BioProjects linked to the matching BioSamples |

The BioProject count shows how many independent studies cover a condition, and exposes cases where a single large project dominates the BioSample count.

Rows and bars of an aggregation are not mutually exclusive. One BioSample contributes to several rows when:

- its term is a descendant of several terms shown as rows,
- it holds several values in a multi-valued field,
- it is linked to experiments of several assays, or
- it is linked to several BioProjects.

The sum of row counts is therefore not equal to the total count.
