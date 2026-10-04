# bsllmner-viewer

bsllmner-viewer is a web application and an HTTP API for querying, aggregating, and visualizing the ontology-mapped BioSample annotations that [bsllmner-mk2](https://github.com/dbcls/bsllmner-mk2) produces.

## Overview

bsllmner-mk2 uses a large language model (LLM) to extract the names of biological entities from the free-text attributes of BioSamples: cell lines, cell types, tissues, diseases, drugs, genetic perturbations, and ChIP antigens. Then bsllmner-mk2 maps each extracted value to an ontology term.

bsllmner-viewer reads the results of bsllmner-mk2, and links each BioSample to its Sequence Read Archive (SRA) Experiments and BioProjects. bsllmner-viewer serves the results and the linked data together through a query API and a browser user interface (UI). bsllmner-viewer has these features:

- Queries on ontology terms that also match the descendants of each term over the directed acyclic graph (DAG) of the ontology. A query can also have conditions on the assay, the organism, the publication date, and the BioProject.
- Aggregations of the matches of a query: distributions, cross-tabulations, and yearly trends. You choose whether an aggregation counts BioSamples, SRA Experiments, or BioProjects.
- An annotation status for each annotation. The status tells whether an exact match mapped the value to a term, whether the LLM selected the term, whether the value has no adopted term, or whether the field has no extracted value.
- Evidence that shows where each extracted value occurs in the original metadata of its BioSample.
- Exports of the matching BioSamples as tab-separated values (TSV) or as newline-delimited JSON (NDJSON), and of the accessions of the matching BioSamples, SRA Experiments, SRA Runs, and BioProjects.
- One condition language for the UI, the URLs of the UI, and the API. You can therefore reproduce every result of the UI through the API. The API follows the conventions of the DDBJ Search API.

In the following diagram of the components, build reads a manifest, the run files of bsllmner-mk2, and reference data, and then writes a store file. The api reads the store file to answer queries, and the frontend shows the answers in a browser.

```
 manifest ---+
 run files --+--> build --> store file --> api --> frontend
 reference --+
```

## Documentation

- [docs/architecture.md](docs/architecture.md): The components, the layout of the repository, and the invariants that involve more than one component
- [docs/data-model.md](docs/data-model.md): What a store represents: the BioSamples and the SRA Experiments that form the population, the original metadata, annotation statuses, the term hierarchy, how a condition is evaluated, and how matches are counted
- [docs/build.md](docs/build.md): What build reads, how build validates its inputs, and how build writes a store
- [docs/provenance.md](docs/provenance.md): How build finds the evidence of each extracted value in the original metadata
- [docs/api.md](docs/api.md): The contract of the HTTP API: the conventions, errors, limits, the condition domain-specific language (DSL), and how the api computes entries, terms, and aggregations
- [docs/deployment.md](docs/deployment.md): The containers of a deployment, their settings and limits, health checks, logs, and what the site serves to crawlers and agents
- [docs/operations.md](docs/operations.md): How to build, update, and publish a dataset, and how to deploy the application
- [docs/development.md](docs/development.md): How to start the development environment, and how to run the checks and the tests
- [docs/testing.md](docs/testing.md): What the tests check, how the tests are divided into kinds, and what a test may replace with a test double

## Acknowledgments

The rules that build uses to find the evidence of each extracted value ([docs/provenance.md](docs/provenance.md)) are based on the provenance tracing that Núria Fàbrega developed at DBCLS BioHackathon 2026 ([nuriafari/BH26_BioSample_bsllmner_mk2_value_provenance](https://github.com/nuriafari/BH26_BioSample_bsllmner_mk2_value_provenance)). In that work, Núria Fàbrega finds where each value that bsllmner-mk2 extracted occurs in the BioSample records, and analyzes which submitted field names contain the values. bsllmner-viewer uses the deterministic matching strategies of that work.

## License

Copyright 2026 BioData Science Initiative (BSI).

Licensed under the Apache License, Version 2.0 (the "License"); you may not use the files in this repository except in compliance with the License. You may obtain a copy of the License at <http://www.apache.org/licenses/LICENSE-2.0>, or from the [`LICENSE`](LICENSE) file distributed with this repository.

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
