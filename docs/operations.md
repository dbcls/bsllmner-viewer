# Operations

This document describes how a dataset is built, updated, published, and deployed. The inputs and their validation are specified in [build.md](build.md); the development environment in [development.md](development.md).

## Building a store

Builds run the `bsllmner-viewer-build` command of the backend package inside the api container. The manifest and every input it references must be visible inside the container; in the compose files the data directory is mounted at `/data`.

```
docker compose run --rm --no-deps api uv run bsllmner-viewer-build full \
  --manifest /data/manifests/dataset.yaml --out /data/store/dataset-2026-09-30.duckdb --workers 6
```

- `full` reads every run and reference source of the manifest and writes a new store file. The output path must not exist.
- `--workers` is the number of processes that read run results and find their evidence in parallel. Each worker holds one result file in memory (up to a few GB for the largest files).
- The command prints the verification result as JSON and exits with status 1 when verification fails.

A manifest looks like this. Paths are relative to the manifest's directory.

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

The SRA experiment and BioProject sources may be a directory, in which case every `*.jsonl` file under it is read (for SRA, only files whose name contains `experiment`). The ChIP-Atlas experiment list is the `experimentList.tab` file published by ChIP-Atlas.

## Appending runs

Add the new runs to the end of the list of runs of the manifest and run `append` with the current store:

```
docker compose run --rm --no-deps api uv run bsllmner-viewer-build append \
  --manifest /data/manifests/dataset.yaml --store /data/store/current.duckdb --out /data/store/dataset-2026-10-31.duckdb
```

The runs already in the store must be listed first and in the same order. Reference data is read again from the manifest so that the new BioSamples get their relations.

## Refreshing reference data or target assays

Update the reference section or the target assays of the manifest and run `refresh`:

```
docker compose run --rm --no-deps api uv run bsllmner-viewer-build refresh \
  --manifest /data/manifests/dataset.yaml --store /data/store/current.duckdb --out /data/store/dataset-2026-11-05.duckdb
```

## Verifying and inspecting a store

```
docker compose run --rm --no-deps api uv run bsllmner-viewer-build verify --store /data/store/dataset-2026-09-30.duckdb
docker compose run --rm --no-deps api uv run bsllmner-viewer-build info --store /data/store/dataset-2026-09-30.duckdb
```

`info` prints the dataset version information that the api returns.

## Publishing

The api opens the store named by `BSLLMNER_VIEWER_STORE` when it starts and keeps it open read-only. Publication is a file switch:

1. Build and verify the new store file next to the current one.
2. Point the api at the new file: replace the `current.duckdb` symlink (or change `BSLLMNER_VIEWER_STORE_FILE`) and restart the api container. nginx in the web container looks up the address of the api again every 10 seconds, so the web container does not need a restart.
3. Keep the previous file until the new one has been checked in the UI; reverting is the same switch in the other direction.

A store file that is being served is never modified. Old files can be deleted once no api process refers to them.

A store holds the version of the store schema that it was written with, and the api starts only with a store of the schema version that its own code reads. If an update of the code changes the schema, then write a new store with `refresh` before you restart the api.

## Deployment

`deploy/compose.yml` runs two containers: `api` (the FastAPI server) and `web` (nginx, which serves the built frontend and proxies `/api` to the api). The web container serves the frontend built for the same origin, so the frontend needs no configuration: the browser calls `/api` on the host that served the page.

Copy `deploy/.env.example` to `deploy/.env` and set the variables. Every compose command reads `deploy/.env` automatically, and git ignores it. Then build the images and start the containers:

```
cd deploy
BSLLMNER_VIEWER_COMMIT=$(git rev-parse --short HEAD) podman-compose -p bsllmner-viewer build
podman-compose -p bsllmner-viewer up -d
```

- Give the project name with `-p` to every command (`ps`, `logs`, `restart`, and `down` too). Without it, podman-compose names the project after the directory, `deploy`. The commands are the same with `docker compose`.
- `up -d` does not rebuild an image that exists. After you update the code, run `build` before `up -d`.
- Both containers have the restart policy `always`. With rootless podman, containers start again after the host reboots only if the deploying user has lingering enabled (`loginctl enable-linger`) and the user service `podman-restart.service` enabled (`systemctl --user enable podman-restart.service`). That service starts only the containers whose policy is `always`.

| Variable | Meaning |
|---|---|
| `BSLLMNER_VIEWER_STORE_DIR` | Directory holding the store files; mounted read-only at `/data/store` |
| `BSLLMNER_VIEWER_STORE_FILE` | File in that directory to serve (default `current.duckdb`) |
| `BSLLMNER_VIEWER_PORT` | Host port of the web container (default 20081) |
| `BSLLMNER_VIEWER_API_WORKERS` | uvicorn worker processes (default 2); each opens the store |
| `BSLLMNER_VIEWER_THREADS` | DuckDB threads per worker (default 8) |
| `BSLLMNER_VIEWER_NOINDEX` | `true` for a deployment that search engines must not index, such as a staging deployment (default `false`) |
| `BSLLMNER_VIEWER_COMMIT` | Commit that the images carry. The footer of the frontend and the version in `/api/service-info` show it. Only the build reads it, so give it on the command that builds the images, not in `deploy/.env`. If it is not set, then no commit is shown |

### Health

`GET /api/service-info` reports `"store": "ok"` while the api can query the store. The health check of the api container calls it, and `podman ps` shows the container as unhealthy when the check fails. An external monitor should check the same URL on the public host.

Logs go to the container logs: `podman logs bsllmner-viewer_api_1` for the api requests and `podman logs bsllmner-viewer_web_1` for the nginx access log.

### Crawlers

The web container serves `/robots.txt` and `/llms.txt`.

- `/llms.txt` describes the site and the API in Markdown, for programs such as LLM agents.
- If `BSLLMNER_VIEWER_NOINDEX` is `true`, then `/robots.txt` allows only the API and `/llms.txt`, and every response has the header `X-Robots-Tag: noindex`. The API stays open to programs that follow robots.txt.
- Otherwise, `/robots.txt` disallows `/entries` with parameters and the exports. Their combinations are endless, and each of them is a query.
