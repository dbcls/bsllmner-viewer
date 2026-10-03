# bsllmner-viewer

bsllmner-viewer is a web application and HTTP API for querying, aggregating, and visualizing ontology-mapped BioSample annotations produced by [bsllmner-mk2](https://github.com/dbcls/bsllmner-mk2).

## Overview

bsllmner-mk2 extracts biological entities (cell line, cell type, tissue, disease, drug, genetic perturbations, ChIP antigen) from free-text BioSample attributes with an LLM and maps each extracted value to an ontology term. bsllmner-viewer ingests those results, links each BioSample to its SRA experiments and BioProjects, and serves the combined data through a query API and a browser UI.

- **Structured queries** over ontology terms, with descendant expansion over the ontology DAG, combined with assay, organism, publication date, and BioProject conditions
- **Aggregations** of the matches as distributions, cross-tabulations, and yearly trends, counted by BioSample, SRA Experiment, or BioProject
- **Annotation status** that distinguishes terms mapped by exact match, terms selected by the LLM, values without an adopted term, and fields without an extracted value
- **Export** of matching BioSamples as TSV / NDJSON, and of BioSample, SRA Experiment, SRA Run, and BioProject accession lists
- **One condition language** shared by the UI, its URLs, and the API, so every result shown in the UI can be reproduced through the API. The API follows the conventions of the DDBJ Search API

```
 manifest ---+
 run files --+--> build --> store file --> api --> frontend
 reference --+
```

## Documentation

- [docs/architecture.md](docs/architecture.md) — Components, their responsibilities, and invariants that span them
- [docs/data-model.md](docs/data-model.md) — Datasets, population, entities, annotation status, and counting semantics
- [docs/build.md](docs/build.md) — Build inputs, validation, operations, and dataset version information
- [docs/provenance.md](docs/provenance.md) — Provenance tracing: how build links each extracted value to evidence in the original metadata
- [docs/api.md](docs/api.md) — API conventions, condition DSL, entries, aggregation semantics, correspondence between API queries and UI views, and compatibility policy
- [docs/development.md](docs/development.md) — Running the containers, tests, and checks
- [docs/testing.md](docs/testing.md) — Kinds of tests, what is tested, test doubles, and the end-to-end policy
- [docs/operations.md](docs/operations.md) — Building, updating, publishing, and deploying a dataset, health monitoring, and crawler settings

## Provenance tracing

For each extracted value, bsllmner-viewer shows the evidence in the original metadata of the BioSample. The rules that find this evidence are based on the provenance tracing that Núria Fàbrega developed at DBCLS BioHackathon 2026: [nuriafari/BH26_BioSample_bsllmner_mk2_value_provenance](https://github.com/nuriafari/BH26_BioSample_bsllmner_mk2_value_provenance). That work traces the values that bsllmner-mk2 extracted to their source text in the BioSample records, and analyzes which submitted field names contain them. bsllmner-viewer uses the deterministic matching strategies of that work. [docs/provenance.md](docs/provenance.md) specifies the rules that bsllmner-viewer implements.

## License

Copyright 2026 BioData Science Initiative (BSI).

Licensed under the Apache License, Version 2.0 (the "License"); you may not use the files in this repository except in compliance with the License. You may obtain a copy of the License at <http://www.apache.org/licenses/LICENSE-2.0>, or from the [`LICENSE`](LICENSE) file distributed with this repository.

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
