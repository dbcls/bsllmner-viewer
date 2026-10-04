# Provenance Tracing

Provenance tracing links each extracted value of a BioSample to evidence in the original metadata of the BioSample ([data-model.md](data-model.md#entities)). With the evidence, a user can check what an annotation was derived from. For example, the knockout gene `Whsc1` of a BioSample whose description says "ChIPseq and RNAseq in Whsc1KO E12.5 heart" has its evidence in that description.

This document specifies how build finds evidence. The rules are based on the deterministic matching strategies of the provenance tracing by Núria Fàbrega ([nuriafari/BH26_BioSample_bsllmner_mk2_value_provenance](https://github.com/nuriafari/BH26_BioSample_bsllmner_mk2_value_provenance)).

## Evidence

A piece of evidence identifies the following:

- an item of the original metadata,
- whether the match is in the name or in the value of the item,
- the range of the match in the text, as positions counted in Unicode code points from the start of the stored text, and
- the matching strategy that found the match.

Of the names of the items, build searches only the names of attributes. The submitter chose those names, and the api gives the names of the other items. A submitter sometimes writes a value as the name of an attribute, as in `spiperone treatment` with the value "yes".

Evidence is best-effort in both directions:

- An extracted value without evidence can still come from the original metadata. For example, the LLM can expand an abbreviation, or it can combine words from two attributes.
- Evidence shows where the text of a value occurs. Evidence does not show that the annotation is correct. For example, a gene that is the target of a ChIP experiment has evidence even if the LLM extracted the gene as a knockout gene.

## Matching strategies

build tries the strategies in the order of the following table. Each strategy accepts more variation than the strategy before it. Before the search, build removes the white space at the start and the end of the extracted value.

| Strategy | Accepts | Example: value, then text |
|---|---|---|
| `exact` | No variation | `DLD-1`, "DLD-1 cell line" |
| `case_insensitive` | Letter case and Unicode compatibility forms | `HeLa`, "Hela-S3" |
| `normalized` | Separators, brackets, and genotype affixes | `CUDC-101`, "CUDC 101" |
| `bag_of_words` | Word order | `LSD1 inhibitor`, "Inhibitor_LSD1" |
| `fuzzy` | Small spelling errors | `erythroid`, "Erytrhoid" |
| `ontology_synonym` | Other names of the assigned term | `adriamycin`, "treated with doxorubicin" |

The strategies use these definitions:

- A unit is a character together with the combining marks and the Hangul vowel and final consonant jamo that follow it. For example, the letter `é` is one unit, whether it is written as one code point (U+00E9) or as `e` and U+0301. A character that NFKC changes to one of these marks or jamo also continues the unit before it, such as the half-width voiced mark U+FF9E after a half-width kana. A match never starts or ends inside a unit. The span of a match is always in the original text, and it covers whole units.
- To fold a text is to apply Unicode Normalization Form KC (NFKC) to each unit, and then case folding. A composed text and a decomposed text therefore fold to the same text. For example, `Müller` matches "Müller" whichever form each of them uses.
- A match is at word boundaries if it does not cut a run of letters and digits. If the match starts with a letter or a digit, then the character before the match is not a letter or a digit. If the match ends with a letter or a digit, then the character after the match is not a letter or a digit. A combining character counts as part of the letter before it. Word boundaries prevent a match inside a longer word. For example, `ATM` does not match "treatment", but `CD4+` matches "CD4+CD8+ T cells".
- A word is a maximal run of letters and digits, together with the `+` and `-` signs right after it. A `+` or `-` that a letter or a digit follows joins two words and is not a sign. For example, `CD19+` and `CD19-` are different words, and "Long-Lived" and "GM+CSF" are two words each.
- The length of a value is its number of units. A composed value and a decomposed value therefore have the same length.

### exact

The text contains the value as it is, at word boundaries. A value of any length can match. For example, `AR` matches "AR knockdown".

build searches for a value of fewer than three units only with `exact`. A short value can also be an ordinary word in another letter case. For example, the drug `NO` (nitric oxide) does not match "No treatment".

### case_insensitive

The folded text contains the folded value, at word boundaries.

### normalized

build folds the value and the text. Then it compares them in three forms:

1. Each run of spaces, tabs, line breaks, hyphens, and underscores becomes one space. Each pair of brackets (`()`, `[]`, or `{}`) is removed together with its content. For example, `Sinoatrial node cells` matches "Sinoatrial node (SAN) cells".
2. The same separators are removed. Brackets are removed together with their content. For example, `HEK293` matches "HEK 293".
3. Each run of the same separators and bracket characters becomes one space. The content of the brackets stays. For example, `lung carcinoma` matches "lung (carcinoma) cell line".

In forms 1 and 2, any closing bracket closes any opening bracket, and an opening bracket without a closing bracket is removed together with the rest of the text. Slashes, periods, and other punctuation stay as they are in all three forms. If a form of the value has fewer than three characters, then that form does not match.

build widens the span of a match over a bracket right next to the match. If the match has an opening bracket without its closing bracket, and a closing bracket comes right after the match, then the span also covers that closing bracket. In the same way, the span covers an opening bracket right before a match that has a closing bracket without its opening bracket. For example, the span of `lung carcinoma` in "lung (carcinoma) cell line" is "lung (carcinoma)". In "lung (carcinoma cell) line", the closing bracket is not right after the match, so the span is "lung (carcinoma".

The match must be at word boundaries in the original text, with exceptions for the names of genotypes and constructs. These names often attach a gene to the words around it without a separator. The match can cut a run of letters and digits at these places:

- before a run that follows the match, if the whole run is one of `KO`, `ko`, `CKO`, `cKO`, `fl`, `f`, `flox`, `LSL`, `GFP`, `eGFP`, `OE`, `KD`, `wt`, `Cre`, `IRES`, `lox`, `delta`, `del`, or `s`, compared with letter case
- before a run that follows the match, if the whole run is a point mutation: an uppercase letter, one to four digits, and an uppercase letter, such as `G12D`
- after a run that comes before the match, if the whole run is one of `sh`, `si`, `sg`, `TRE`, or `peg`, compared with letter case
- where a lowercase letter meets an uppercase letter in the original text

For example, `Whsc1` matches "Whsc1KO", `KRAS` matches "KRASG12D", `p53` matches "shp53", `Neurod1` matches "Ngn3CreNeurod1OE", and `STAT3` matches "pSTAT3". A digit that meets an uppercase letter is not an exception, because identifiers continue that way. For example, `TP53` does not match "TP53BP1", which is a different gene.

### bag_of_words

This strategy applies only to a value of two or more words. The text has a sequence of consecutive words that contains the same words as the value, in any order. build compares the words after it folds them. Each word must be equal to a word of the value. For example, `CD4 T cell` matches "T cell CD4".

### fuzzy

The text has a sequence of consecutive words that has the same number of words as the value, in the same order. Each word of the sequence is similar to the word of the value at the same position. At least one pair of words is not equal, because an equal sequence matches an earlier strategy.

build compares two words after it folds them. Two words are similar if one of these conditions is true:

- The words are equal.
- The words have the same length and differ in one character, and the two characters are both in the group of `l`, `i`, and `1`, or both in the group of `o` and `0`. The length of the words does not matter. For example, `DNase I` matches "DNase l".
- The shorter word has six characters or more, and the Levenshtein distance between the words is small enough. The Levenshtein distance is the number of characters to insert, delete, or replace to change one word into the other. The maximum distance is 1 if the shorter word has six or seven characters, 2 if it has 8 to 13 characters, and 3 if it has 14 characters or more. If either word contains a digit, then both words must contain the same sequence of digits, and the maximum distance is 1. Identifiers that differ only in their digits often name different things. For example, `ADAMTS13` does not match "ADAMTS12".

### ontology_synonym

This strategy applies only to an extracted value that has a term. build searches for the label and the synonyms of the term, with the five strategies above in the same order. For example, the drug `adriamycin` whose term is doxorubicin has its evidence in "treated with doxorubicin". For each strategy, build tries every name of the term before it tries the next strategy. An `exact` match of a synonym is therefore found before a `fuzzy` match of the label.

The names are the label and the synonyms of the term in the reference ontology files ([build.md](build.md#reference-data)), and the label that the run result gives the term. If a name has fewer than five units, then build searches for that name only with `exact`. A short name can also be an ordinary word. For example, the ChEBI synonym `NO` (nitric oxide) does not match "No dairy".

## Search order

build searches the original metadata in three groups:

1. the description ([data-model.md](data-model.md#entities)) and the values of the attributes
2. the names of the attributes
3. the record

For each strategy in order, build searches the groups in this order. build stops at the first strategy and group in which the value matches. Every match in that group with that strategy becomes evidence: each occurrence in each item. If an occurrence overlaps an earlier occurrence in the same item, then build does not use it. All evidence of one extracted value therefore has the same strategy, and all of it is in the same group.

For example, take the cell line `HeLa` of a BioSample whose `cell line` attribute is "HeLa" and whose title is "ChIP-seq of HeLa cells". Both the attribute and the title are evidence by `exact`. An ID in the record, such as "HeLa_ChIP_rep1", is not evidence, because the first group already has an `exact` match.

The names of the attributes come after their values, because a name usually says what kind of value follows and only sometimes holds the value itself. For example, the tissue `brain` of a BioSample with the attribute `tissue` "brain" and the attribute `brain region` "BA46" has its evidence only in the value of `tissue`. The record comes last, because its values are identifiers, dates, and names. An extracted value occurs by chance in those values more often than in the words that describe the BioSample. `ontology_synonym` does not search the record, because a name of the term in an identifier is a coincidence.

## When build finds evidence

- build finds evidence with the strategies from `exact` to `fuzzy` when it ingests a run, because these strategies depend only on the run. Of the record, build keeps only the items that evidence points to ([build.md](build.md#runs)).
- build finds evidence with `ontology_synonym` when it derives query-ready data, because the names of terms come from the reference data. build searches only for the extracted values that have a term and that have no evidence from the other strategies. A reference refresh therefore finds this evidence again.
- The api returns the stored evidence with the annotations of a BioSample ([api.md](api.md#entries)). The api does not search the original metadata.
