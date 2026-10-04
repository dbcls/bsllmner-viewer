# Data Model

This document defines what a store represents:

- the BioSamples and the SRA Experiments that form the population
- what the store records about them
- how annotations are classified
- how conditions are evaluated
- how matches are counted

[build.md](build.md) specifies the inputs, and how build writes a store.

## Dataset

A dataset has three parts:

- a set of runs of bsllmner-mk2 that all used the same model
- reference data
- a list of target assays, which are values of the SRA `library_strategy`

A store file represents one version of one dataset.

## Population

The population is a set of pairs of a BioSample and an SRA Experiment that is linked to the BioSample. A pair is in the population if both of the following are true:

- A run of the dataset analyzed the BioSample.
- The `library_strategy` of the experiment is one of the target assays.

If a BioSample is linked to several experiments of target assays, then the population has one pair for each of these experiments.

A run can analyze a BioSample that is linked to no experiment of a target assay. The store keeps such a BioSample, but the population does not include the BioSample. If you add an assay to the target assays, then such BioSamples with experiments of that assay become part of the population. For this change, build does not read the runs again.

## Entities

| Entity | Attributes | Relationships |
|---|---|---|
| BioSample | Accession, organism, title, publication date, original metadata | 1:N with SRA Experiment, N:M with BioProject |
| SRA Experiment | Accession, `library_strategy` | N:1 with BioSample, 1:N with SRA Run |
| SRA Run | Accession | N:1 with SRA Experiment |
| BioProject | Accession, title | N:M with BioSample |
| Annotation | Field, extracted value, status, term | N:1 with BioSample |
| Evidence | Item of the original metadata, whether the match is in the name or in the value of the item, character range, matching strategy | N:1 with Annotation |
| Ontology term | ID, label, synonyms, parent terms | Parent–child relations form a hierarchy |

The annotation fields are the fields of the bsllmner-mk2 select configuration that the runs used. A field holds either a single value or multiple values.

Evidence shows where an extracted value occurs in the original metadata of its BioSample. With the evidence, users can check what an annotation was derived from. [provenance.md](provenance.md) specifies how build finds evidence.

### Original metadata

The original metadata of a BioSample is the content that the input entry of the BioSample gives to the LLM. The input entry is the entry of the BioSample in the input file of a run ([build.md](build.md#runs)). The original metadata has three kinds of items:

- The description: the title, the description paragraphs, the sample name, and the synonyms.
- The attributes, except some attributes that record how the BioSample was submitted and archived.
- The record of the entry: the IDs, status, dates, owner, links, model, package, and organism of the entry. The store keeps only the items of the record that evidence points to, because the other items are identifiers and dates that no annotation was derived from. The store does not keep the contacts of the owner, because the contacts give the names of people.

bsllmner-mk2 lists in its `filter_keys.json` the names of some attributes that record how a BioSample was submitted and archived, such as `INSDC status`, `gap_accession`, and `GEO Accession`. An attribute with one of these names is part of the original metadata of a BioSample only if evidence of the BioSample points to the attribute, that is, only when an annotation of the BioSample was derived from the attribute.

For example, `INSDC center name` and `Submitter Id` are two of these names. An `INSDC center name` attribute is not part of the original metadata. A `Submitter Id` attribute with the value `E-MTAB-13151:ChIP_ETO2_DMSO_rep1` is part of the original metadata if build found the evidence of the ChIP antigen ETO2 in the value.

[build.md](build.md#runs) specifies which of these attributes the store keeps. The attributes that the store keeps include attributes that are not part of the original metadata ([Condition evaluation](#condition-evaluation)).

### Organism

Input entries do not always give the same name for an organism. For example, some entries give `human` or `9606` for `Homo sapiens`. Wherever the api names an organism by its NCBI Taxonomy ID, for example in aggregations, in the labels of conditions, and in the description of the dataset, the api uses the name that most BioSamples of the dataset give for the ID. If several names are given by the largest number of BioSamples, then the api uses the first of these names in character order. A BioSample and its entries keep the name that the input entry of the BioSample gives.

### Publication date

Of the dates of a BioSample, build takes only the publication date (`publication_date`), because the publication date is the only date that has the same meaning for every BioSample:

- Every input entry has `publication_date`, whether NCBI, EBI, or DDBJ registered the BioSample.
- DDBJ entries (`SAMD`) do not have `submission_date`. In EBI entries (`SAME`), `submission_date` is usually later than the publication date.

As the DDBJ Search API does, build stores the date in Coordinated Universal Time (UTC).

A publication date is unknown if the date cannot be the day on which the BioSample became public. The following dates are unknown:

- A date after the day on which the run started (`run_metadata.start_time`). The run analyzed the BioSample after the BioSample had become public, so such a date is a planned release date.
- A date before 2005-01-01, such as 2000-01-01. The sequencing assays of a dataset produced no data before 2005, so such a date is a placeholder.

A BioSample with an unknown date does not match a clause on the date, so the BioSample matches the negation of the clause. A trend does not count such a BioSample ([api.md](api.md#trend)). The DDBJ Search API keeps such dates unchanged. Therefore, the same condition on the date can select different BioSamples in the DDBJ Search API and in this API.

## Annotation status

Annotations come from an LLM, so an annotation can be wrong. Every annotation has a status. The statuses have two levels: three groups, and two statuses in each group.

| Group | Status | Scope | Meaning |
|---|---|---|---|
| `no_value` | `not_stated` | Field | No value was extracted for the field. |
| | `extraction_failed` | BioSample | The LLM output for the BioSample could not be interpreted, so no field has a value. |
| `unmapped` | `unmapped_no_candidate` | Extracted value | No ontology term was a candidate for the value. |
| | `unmapped_rejected` | Extracted value | Candidate terms existed, but none was adopted. |
| `mapped` | `mapped_exact` | Extracted value | The term was determined automatically by an exact match against an ontology label or synonym, without an LLM call. |
| | `mapped_selected` | Extracted value | The term was selected by the LLM from the candidate terms. |

- A condition specifies a group, not a single status, and the condition matches every status in the group. In the same way, a condition on a term matches the descendants of the term. The entries and the exports of the api show the status of each annotation.
- `no_value` means that nothing was extracted, not that the BioSample lacks the property. For example, if no drug was extracted for a BioSample, then the BioSample is not necessarily untreated.
- `unmapped_no_candidate` means that the ontology has no label or synonym that resembles the value. `unmapped_rejected` means that similar terms exist, but none of the similar terms was adopted. Typically, the reason is that the LLM judged the similar terms inconsistent with the metadata of the BioSample.
- In a multi-valued field, a BioSample can have several statuses at the same time.

[build.md](build.md#reading-annotations) specifies how build reads the status of each annotation from a run result.

## Term hierarchy

A condition on a term matches the term itself and all descendants of the term.

- To find the descendants, build follows two relations of the ontology: is-a and part-of. A term with several parents is a descendant of each parent. The files of an ontology state the two relations in these forms:
  - is-a: `is_a` in the OBO format, and `rdfs:subClassOf` in the Web Ontology Language (OWL)
  - part-of: `part_of` or `BFO:0000050` in the OBO format, and in OWL an `owl:Restriction` on `BFO_0000050` with `owl:someValuesFrom` inside an `rdfs:subClassOf`
- For part-of, build follows only the relations from a term to a parent with the same prefix, such as from UBERON to UBERON or from CL to CL, so that the hierarchy of a field stays inside the ontology of the field. For is-a, build also follows the relations to a parent with another prefix.
- Except for is-a and part-of, build follows no relation, such as `develops_from`. In addition, build ignores a part-of relation with the qualifier `all_only="true"`, because such a relation does not state that a part exists.
- If an `is_a` line or a `relationship` line of an OBO file has the qualifier `gci_relation` or `gci_filler`, then build ignores the line, because such a line is a general class inclusion axiom. The axiom holds only for the individuals that satisfy the condition of the axiom, so the axiom does not give an unconditional parent. An OWL file states these axioms as anonymous classes, and build does not read these anonymous classes as terms.
- The two relations are combined into one hierarchy. If the combined hierarchy has a cycle, then build does not stop with an error.
- A term without descendants matches only itself. If an ontology has no hierarchy, then no term of the ontology has descendants.
- If a file marks a term as obsolete (`is_obsolete: true` in OBO, `owl:deprecated` in OWL), then build does not read the term from that file. If every file that defines an annotated term marks the term as obsolete, then the term is therefore absent from the reference ontology.
- An annotated term can be absent from the reference ontology. A condition on the ID of such a term still matches the annotations that have the term. Such a term has no descendants, and the label of such a term is the label that the run result records.

## Condition evaluation

The api evaluates a condition on each pair of the population. A pair is a BioSample and one of its experiments, so the api evaluates the condition on a BioSample once for each experiment that forms a pair with the BioSample.

- The api evaluates a clause on annotations, on the organism, on the publication date, or on the BioProject against the BioSample of the pair.
- The api evaluates a clause on `library_strategy` against the experiment of the pair.
- The api evaluates keywords against the searchable text of the BioSample. If a word has the form of an accession, then the api evaluates the word against the accessions of the BioSample, of its BioProjects, of the experiment, and of the SRA Runs of the experiment.
- A clause on a field is true if at least one value of the field satisfies the clause. If a BioSample has no publication date or no organism, or if an experiment has no library strategy, then the BioSample or the experiment does not satisfy a clause on the missing field. Therefore, the BioSample or the experiment satisfies the negation of the clause.
- The api evaluates a clause on the status group `no_value` against the whole field, not against each value of the field.

Each evaluation sees the assay of only one experiment. Therefore, a condition that requires two different assays matches nothing, even for a BioSample that has experiments of both assays. Assays are compared by counting the matches for each assay under the same annotation conditions.

The searchable text of a BioSample has these parts:

- the title and the organism name
- the description paragraphs, the sample name, and the synonyms
- the values of every attribute that build keeps for the BioSample
- the extracted values and the term labels of the annotations of the BioSample

The attributes that build keeps include attributes that are not part of the original metadata. Therefore, a BioSample can match a keyword through a value that the page of the BioSample does not show. The names of the attributes are not part of the searchable text, because nearly every BioSample has the same attribute names. The record of the entry is not part of the searchable text, because the values of the record are identifiers and dates, not words about the BioSample. [api.md](api.md#keywords) specifies how keywords match the text.

## Counting

The api counts the matches of a condition in three units.

| Unit | Count |
|---|---|
| BioSample | The number of distinct BioSamples that match the condition together with at least one of their experiments |
| SRA Experiment | The number of distinct experiments that match the condition together with their BioSample |
| BioProject | The number of distinct BioProjects that are linked to the matching BioSamples |

The BioProject count shows how many independent studies the condition covers, and also shows when one large project contributes a large part of the BioSample count.

The rows and the bars of an aggregation do not exclude each other. One BioSample is counted in several rows in these cases:

- The term of the BioSample is a descendant of several terms that are rows.
- The BioSample has several values in a multi-valued field.
- The BioSample is linked to experiments of several assays.
- The BioSample is linked to several BioProjects.

Therefore, the sum of the row counts is not equal to the total count.
