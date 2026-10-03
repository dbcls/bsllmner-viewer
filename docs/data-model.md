# Data Model

This document defines what a store represents: which BioSamples and experiments form the population, how annotations are classified, how conditions are evaluated, and how matches are counted. Input formats and build operations are specified in [build.md](build.md).

## Dataset

A dataset is a set of runs analyzed with a single model, together with reference data and a list of target assays. A store file represents one version of one dataset.

Target assays are a list of SRA `library_strategy` values.

## Population

The population is the set of BioSamples, each together with an SRA experiment linked to it, that satisfy both of the following:

- The BioSample was analyzed by a run in the dataset.
- The experiment's `library_strategy` is one of the target assays.

A BioSample linked to several experiments of target assays is in the population once with each of them.

A BioSample analyzed by a run but linked to no experiment of a target assay is kept in the store and is absent from the population. Adding an assay to the target assays makes such BioSamples part of the population without re-ingesting runs.

## Entities

| Entity | Attributes | Relationships |
|---|---|---|
| BioSample | Accession, organism, title, publication date, original metadata | 1:N with SRA Experiment, N:M with BioProject |
| SRA Experiment | Accession, `library_strategy` | N:1 with BioSample, 1:N with SRA Run |
| SRA Run | Accession | N:1 with SRA Experiment |
| BioProject | Accession, title | N:M with BioSample |
| Annotation | Field, extracted value, status, term | N:1 with BioSample |
| Evidence | Item of the original metadata, name or value of the item, character range, matching strategy | N:1 with Annotation |
| Ontology term | ID, label, synonyms, parent terms | Parent–child relations form a hierarchy |

The original metadata of a BioSample is what its input entry gives the LLM, in three kinds:

- the description: the title, the description paragraphs, the sample name, and the synonyms,
- the attributes, except some attributes that record how the BioSample was submitted and archived ([build.md](build.md#runs)), and
- the record of the entry: its IDs, status, dates, owner, links, model, package, and organism. Only the items of the record that evidence points to are kept, because the rest are identifiers and dates that no annotation was derived from. The contacts of the owner, which name people, are not kept.

Evidence locates an extracted value in the original metadata of its BioSample, so that users can check what an annotation was derived from. How build finds evidence is specified in [provenance.md](provenance.md).

Input entries do not always agree on the name of an organism: some give `human` or `9606` for `Homo sapiens`. Where the api names an organism by its NCBI Taxonomy ID, as in aggregations, condition labels, and the dataset description, it uses the name that most BioSamples of the dataset give for the ID, and of names that equally many BioSamples give, the first in character order. A BioSample and its entries keep the name that its own input entry gives.

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

- A condition names a group and matches every status under it, in the same way that a term matches its descendants. A condition cannot name a single status. The status of each annotation is in the entries and the exports.
- `no_value` means that nothing was extracted; it does not mean the sample lacks the property. A sample without an extracted drug is not necessarily untreated.
- `unmapped_no_candidate` indicates that the ontology has no label or synonym resembling the value. `unmapped_rejected` indicates that similar terms exist but none was adopted, typically because the LLM judged them inconsistent with the BioSample metadata.
- In a multi-valued field, a BioSample can hold several statuses at once.

## Term hierarchy

A condition on a term matches the term itself and all of its descendants.

- Descendants are resolved over two relations of the ontology: is-a (`is_a` in OBO, `rdfs:subClassOf` in OWL) and part-of (`part_of` or `BFO:0000050` in OBO, an `owl:Restriction` on `BFO_0000050` with `owl:someValuesFrom` inside an `rdfs:subClassOf` in OWL). A term with several parents is a descendant of each of them.
- Build follows part-of only from a term to a parent with the same prefix, such as UBERON to UBERON or CL to CL, so that the hierarchy of a field stays within its ontology. It follows is-a across prefixes.
- Build follows no other relation, such as `develops_from`. It also ignores a part-of relation that carries the qualifier `all_only="true"`, because that relation does not state that a part exists.
- Build ignores an `is_a` or `relationship` line of an OBO file that carries the qualifier `gci_relation` or `gci_filler`. Such a line is a general class inclusion axiom, which holds only for the individuals that satisfy its condition, so it is not an unconditional parent. An OWL file states these axioms as anonymous classes, which build does not read as terms.
- The two relations are combined into one hierarchy. A cycle in the combined hierarchy does not stop the build.
- A term without descendants matches only itself. No term of an ontology without hierarchy has descendants.
- An annotated term that is absent from the reference ontology still matches by its ID. It has no descendants, and its label is the one recorded in the run result.

## Condition evaluation

A condition is evaluated on a BioSample of the population together with one of its experiments, once for each experiment.

- Clauses on annotations, organism, publication date, and BioProject are evaluated against the BioSample.
- Clauses on `library_strategy` are evaluated against the experiment.
- Keywords are evaluated against the searchable text of the BioSample. A word in the form of an accession is evaluated against the accessions of the BioSample, its BioProjects, the experiment, and the experiment's runs.
- A clause on a field is true when at least one value of that field satisfies it. A BioSample without a publication date or an organism, or an experiment without a library strategy, does not satisfy a clause on that field, so it satisfies the negation of the clause. A clause on the status group `no_value` is evaluated against the field as a whole.

Because each evaluation sees the assay of a single experiment, a condition that requires two different assays matches nothing, even for a BioSample that has experiments of both. Assays are compared by counting per assay under the same annotation conditions.

The searchable text of a BioSample consists of its title, its organism name, its description paragraphs, sample name, and synonyms, the values of its original attributes, and the extracted values and term labels of its annotations. Attribute names are not part of it, because nearly every BioSample has the same names. The record of the entry is not part of it, because its values are identifiers and dates rather than words about the sample. How keywords match the text is specified in [api.md](api.md).

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
