# Provenance Tracing

Provenance tracing links each extracted value of a BioSample to evidence in the original metadata of the BioSample ([data-model.md](data-model.md#original-metadata)). With the evidence, a user can check what an annotation was derived from. For example, assume that the description of a BioSample says "ChIPseq and RNAseq in Whsc1KO E12.5 heart", and that bsllmner-mk2 extracted the knockout gene `Whsc1` from the BioSample. Then the evidence of `Whsc1` is in that description.

This document specifies how build finds evidence. The rules are based on the deterministic matching strategies of the provenance tracing by Núria Fàbrega ([nuriafari/BH26_BioSample_bsllmner_mk2_value_provenance](https://github.com/nuriafari/BH26_BioSample_bsllmner_mk2_value_provenance)).

## Evidence

A piece of evidence identifies these four things:

- an item of the original metadata
- whether the match is in the name or in the value of the item
- the range of the match in the text, as positions counted in Unicode code points from the start of the stored text
- the matching strategy that build used to find the match

Each item of the original metadata has a name. Of these names, build searches only the names of attributes, because the submitter chose the names of attributes, and the api gives the names of the other items. A submitter sometimes writes a value as the name of an attribute. For example, an attribute can have the name `spiperone treatment` and the value "yes".

Evidence has limits in two directions:

- An extracted value without evidence can still come from the original metadata. For example, the large language model (LLM) of bsllmner-mk2 can expand an abbreviation, or the LLM can combine words from two attributes.
- Evidence shows where the text of a value occurs, but does not show that the annotation is correct. For example, assume that a gene is the target of a ChIP experiment, and that the LLM extracted the gene as a knockout gene. The gene still has evidence.

## Matching strategies

In the order of the following table, build tries the strategies. Each strategy accepts more variation than the strategy before it. Before the search, build removes the white space at the start and at the end of the extracted value.

| Strategy | Accepts | Example: value, then text |
|---|---|---|
| `exact` | No variation | `DLD-1`, "DLD-1 cell line" |
| `case_insensitive` | Letter case and Unicode compatibility forms | `HeLa`, "Hela-S3" |
| `normalized` | Separators, brackets, and genotype affixes | `CUDC-101`, "CUDC 101" |
| `bag_of_words` | Word order | `LSD1 inhibitor`, "Inhibitor_LSD1" |
| `fuzzy` | Small spelling errors | `erythroid`, "Erytrhoid" |
| `ontology_synonym` | Other names of the assigned term | `adriamycin`, "treated with doxorubicin" |

The strategies use these definitions:

- A unit is a character, together with the combining marks and the Hangul vowel and final consonant jamo that follow the character. For example, the letter `é` is one unit, whether the letter is written as one code point (U+00E9) or as `e` and U+0301. A character that changes to one of these marks or jamo under Unicode Normalization Form KC (NFKC) also continues the unit before it, such as the half-width voiced mark U+FF9E after a half-width kana.
- A match never starts or ends inside a unit. The span of a match is the range of the original text that the match covers, and always covers whole units.
- To fold a text, build applies NFKC to each unit, and then applies case folding, which removes the differences of letter case. Therefore, a composed text and a decomposed text fold to the same text. For example, the value `Müller` matches the text "Müller", even if one of them writes `ü` as one code point (U+00FC) and the other writes `ü` as `u` and U+0308.
- A match is at word boundaries if the match does not cut a sequence of letters and digits. If the match starts with a letter or a digit, then the character before the match is not a letter or a digit. If the match ends with a letter or a digit, then the character after the match is not a letter or a digit. A combining mark counts as part of the letter before it. Word boundaries prevent a match inside a longer word. For example, `ATM` does not match "treatment". `CD4+` matches "CD4+CD8+ T cells", because the match ends with `+`, which is not a letter or a digit.
- A word is a maximal sequence of letters and digits, together with the `+` and `-` signs right after the sequence. If a letter or a digit comes after a `+` or a `-`, then the `+` or the `-` joins two words and is not a sign. For example, `CD19+` and `CD19-` are different words. "Long-Lived" is two words, and "GM+CSF" is also two words.
- The length of a value is the number of units in the value. Therefore, a composed value and a decomposed value have the same length.

### exact

The value matches if the text contains the value without any change, at word boundaries. A value of any length can match. For example, `AR` matches "AR knockdown".

If a value has fewer than three units, then build searches for the value with `exact` only, because a short value can also be an ordinary word in another letter case. For example, the drug `NO` (nitric oxide) does not match "No treatment".

### case_insensitive

The value matches if the folded text contains the folded value, at word boundaries.

### normalized

In this strategy, build folds the value and the text, converts both into three forms, and compares the value and the text in each form:

1. Each sequence of spaces, tabs, line breaks, hyphens, and underscores becomes one space. Each pair of brackets (`()`, `[]`, or `{}`) is removed together with its content. For example, `Sinoatrial node cells` matches "Sinoatrial node (SAN) cells".
2. The separators of form 1 are removed. Brackets are removed together with their content. For example, `HEK293` matches "HEK 293".
3. Each sequence of the separators of form 1 and of bracket characters becomes one space. The content of the brackets stays. For example, `lung carcinoma` matches "lung (carcinoma) cell line".

In forms 1 and 2, a closing bracket of any kind closes an opening bracket of any kind. An opening bracket without a closing bracket is removed together with the rest of the text. Slashes, periods, and other punctuation stay unchanged in all three forms. If a form of the value has fewer than three characters, then that form does not match.

In two cases, build widens the span of a match to a bracket that is right next to the match:

- If the match has an opening bracket without its closing bracket, and a closing bracket is right after the match, then the span also covers that closing bracket.
- If the match has a closing bracket without its opening bracket, and an opening bracket is right before the match, then the span also covers that opening bracket.

For example, the span of `lung carcinoma` in "lung (carcinoma) cell line" is "lung (carcinoma)". In "lung (carcinoma cell) line", the closing bracket is not right after the match, so the span is "lung (carcinoma".

The match must be at word boundaries in the original text, but there are exceptions for the names of genotypes and genetic constructs. Such a name often joins a gene to the words around the gene without a separator. Therefore, the match can cut a sequence of letters and digits at these places:

- at the end of the match, if the whole sequence right after the match is one of `KO`, `ko`, `CKO`, `cKO`, `fl`, `f`, `flox`, `LSL`, `GFP`, `eGFP`, `OE`, `KD`, `wt`, `Cre`, `IRES`, `lox`, `delta`, `del`, or `s`, compared case-sensitively
- at the end of the match, if the whole sequence right after the match is a point mutation: an uppercase letter, one to four digits, and an uppercase letter, such as `G12D`
- at the start of the match, if the whole sequence right before the match is one of `sh`, `si`, `sg`, `TRE`, or `peg`, compared case-sensitively
- where a lowercase letter meets an uppercase letter in the original text

For example:

- `Whsc1` matches "Whsc1KO".
- `KRAS` matches "KRASG12D".
- `p53` matches "shp53".
- `Neurod1` matches "Ngn3CreNeurod1OE".
- `STAT3` matches "pSTAT3".

A place where a digit meets an uppercase letter is not an exception, because identifiers continue in that way. For example, `TP53` does not match "TP53BP1", which is a different gene.

### bag_of_words

This strategy applies only to a value of two or more words. The value matches if the text has a sequence of consecutive words that contains the same words as the value, in any order, and no other words. Before the comparison, build folds the words. For example, `CD4 T cell` matches "T cell CD4".

### fuzzy

The value matches if the text has a sequence of consecutive words with these properties:

- The sequence has the same number of words as the value.
- Each word of the sequence is similar to the word of the value at the same position.
- At least one pair of words is not equal, because an earlier strategy already matches a sequence of equal words.

Before build compares two words, build folds the two words. Two words are similar if one of these conditions is true:

- The words are equal.
- The words have the same length and differ in one character, and the two different characters are both in the group of `l`, `i`, and `1`, or both in the group of `o` and `0`. The length of the words does not matter for this condition. For example, `DNase I` matches "DNase l".
- The shorter word has six characters or more, and the Levenshtein distance between the words is small enough. The Levenshtein distance is the number of characters to insert, delete, or replace to change one word into the other. The maximum distance depends on the length of the shorter word: 1 for 6 or 7 characters, 2 for 8 to 13 characters, and 3 for 14 characters or more. If either word contains a digit, then both words must contain the same sequence of digits, and the maximum distance is 1. The reason is that identifiers that differ only in their digits often name different things. For example, `ADAMTS13` does not match "ADAMTS12".

### ontology_synonym

This strategy applies only to an extracted value that has a term. In this strategy, build searches for the label and the synonyms of the term, with the five strategies above in the same order. For example, the drug `adriamycin` has the term doxorubicin, so the evidence of `adriamycin` is in "treated with doxorubicin". For each strategy, build tries every name of the term before build tries the next strategy. Therefore, build finds an `exact` match of a synonym before a `fuzzy` match of the label.

The names of a term are these names:

- the label and the synonyms of the term in the reference ontology files ([build.md](build.md#reference-data))
- the label that the run result gives to the term

If a name has fewer than five units, then build searches for that name with `exact` only, because a short name can also be an ordinary word. For example, the ChEBI synonym `NO` (nitric oxide) does not match "No dairy".

## Search order

In the original metadata, build searches three groups:

1. the description ([data-model.md](data-model.md#original-metadata)) and the values of the attributes
2. the names of the attributes
3. the record

For each strategy in order, build searches the groups in this order. At the first strategy and group in which the value matches, build stops. Every match with that strategy in that group becomes evidence: each occurrence in each item. If an occurrence overlaps an earlier occurrence in the same item, then build does not use the later occurrence. Therefore, all evidence of one extracted value has the same strategy, and all of the evidence is in the same group.

For example, consider the cell line `HeLa` of a BioSample. The `cell line` attribute of the BioSample is "HeLa", and the title of the BioSample is "ChIP-seq of HeLa cells". With `exact`, build finds evidence in both the attribute and the title. An ID in the record, such as "HeLa_ChIP_rep1", is not evidence, because the first group already has an `exact` match.

In the search order, the names of the attributes come after the values of the attributes, because the name of an attribute usually tells the kind of the value, and only sometimes holds the value itself. For example, a BioSample has the attribute `tissue` with the value "brain", and the attribute `brain region` with the value "BA46". The evidence of the tissue `brain` is only in the value of `tissue`.

The record comes last in the search order, because the values of the record are identifiers, dates, and names. An extracted value occurs by chance in those values more often than in the words that describe the BioSample. With `ontology_synonym`, build does not search the record, because a name of the term inside an identifier is a coincidence.

## When build finds evidence

- When build ingests a run, build finds evidence with the strategies from `exact` to `fuzzy`, because these strategies depend only on the run. From the record, build keeps only the items that evidence points to ([build.md](build.md#runs)).
- When build computes the derived data ([build.md](build.md#operations)), build finds evidence with `ontology_synonym`, because the names of terms come from the reference data. In this step, build searches only for the extracted values that have a term and that have no evidence from the other strategies. Therefore, a reference refresh finds this evidence again.
- The api returns the stored evidence with the annotations of a BioSample ([api.md](api.md#entries)), and does not search the original metadata.
