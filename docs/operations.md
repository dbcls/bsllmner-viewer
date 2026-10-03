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

A store holds the version of the store schema that it was written with, and the api starts only with a store of the schema version that its own code reads. If an update of the code changes the schema, then write a new store with a full build before you restart the api. `refresh` and `append` reject a store of another schema version.

## Deployment

`deploy/compose.yml` runs two containers: `api` (the FastAPI server) and `web` (nginx, which serves the built frontend and proxies `/api` to the api). The web container serves the frontend built for the same origin, so the frontend needs no configuration: the browser calls `/api` on the host that served the page. The build context of the web image is the root of the repository, because the build also reads `docs/api.md` and `docs/data-model.md` to make `/llms-full.txt`. `.dockerignore` at the root is an allowlist, so the context has only `frontend/` and these two documents.

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
| `BSLLMNER_VIEWER_MEMORY_LIMIT` | DuckDB memory per worker (default `4GB`) |
| `BSLLMNER_VIEWER_MAX_TEMP_SIZE` | Disk space that DuckDB can use per worker for data that does not fit in memory (default `20GB`) |
| `BSLLMNER_VIEWER_QUERY_TIMEOUT` | Seconds that a request may read the store (default 60) |
| `BSLLMNER_VIEWER_MAX_QUERIES` | Requests per worker that read the store at the same time (default 8) |
| `BSLLMNER_VIEWER_MAX_EXPORTS` | Exports per worker at the same time (default 2) |
| `BSLLMNER_VIEWER_QUEUE_TIMEOUT` | Seconds that a request waits for a free slot before the api answers 503 (default 10) |
| `BSLLMNER_VIEWER_NOINDEX` | `true` for a deployment that search engines must not index, such as a staging deployment (default `false`) |
| `BSLLMNER_VIEWER_COMMIT` | Commit that the images carry. The footer of the frontend and the version in `/api/service-info` show it. Only the build reads it, so give it on the command that builds the images, not in `deploy/.env`. If it is not set, then no commit is shown |

### Limits of a worker

Each api worker limits its use of memory, disk, and time, so that one heavy request cannot stop the others. The variables above set the limits. The behavior seen by a client is in [api.md](api.md#limits).

- The api configures DuckDB when it starts, and then locks the configuration. DuckDB can read and write only the store file and its temporary files, and it cannot load an extension.
- Memory: a query that needs more than `BSLLMNER_VIEWER_MEMORY_LIMIT` writes the excess to disk. A cross-tabulation that counts BioProjects (`unit=bioproject`) uses several GB even with 10 terms on each axis, so the limit is a setting that you tune to the host. Each worker has its own limit, so the api can use up to the number of workers times the limit, plus the memory of the Python process, which the limit does not include.
- Disk: the store directory is mounted read-only, so DuckDB writes the excess to the volume `api-temp`, which compose mounts at `/var/tmp/bsllmner-viewer`. Each worker uses a directory of its own in it and removes the directory when it stops. A worker that the system killed leaves its directory, and the next worker that starts in the container removes it. The volume needs the number of workers times `BSLLMNER_VIEWER_MAX_TEMP_SIZE` of free space. A tmpfs does not work, because it takes memory. When a worker is outside compose, `BSLLMNER_VIEWER_TEMP_DIRECTORY` names a writable directory, and the default is a directory in the system temporary directory.
- Time: [api.md](api.md#limits) describes what the limit measures. The default is longer than the slowest query that the documented uses need on the full dataset. Measure that query on the deployment after you change the threads or the dataset.
- Concurrency: a request that reads the store takes one of `BSLLMNER_VIEWER_MAX_QUERIES` slots of its worker. DuckDB shares its threads among the queries of a worker, but every query adds its own calling thread to the computation, so the CPU use of a worker grows with the number of concurrent queries. The default equals the default of `BSLLMNER_VIEWER_THREADS`. The UI sends many requests at once when a view opens, and a request waits when it has no slot. A worker holds the running requests and up to four times as many waiting requests. With fewer than 4 slots, one open view can get 503 responses. Raising the number of slots does not make a query faster, because the queries share the CPU.
- Exports: an export keeps its cursor for as long as the client reads, so exports have slots of their own. The worker frees the slot when the response ends or the client disconnects.

### Health

`GET /api/service-info` reports the state of the store, as [api.md](api.md#service-information) describes. The health check of the api container calls it, and `podman ps` shows the container as unhealthy when the check fails. An external monitor should check the same URL on the public host.

Logs go to the container logs: `podman logs bsllmner-viewer_api_1` for the api requests and `podman logs bsllmner-viewer_web_1` for the nginx access log.

### Limits of the web server

nginx in the web container adds limits and headers that the api does not set.

- nginx accepts request bodies of up to 64 KiB for `/api`. A larger body gets a 413 problem response.
- nginx counts the requests in progress for each client address. A client with more than 100 requests in progress gets a 429 problem response with `Retry-After: 1`. People who share an address share the limit.
- nginx takes the client address from the `X-Real-IP` request header only when the peer address is a private IPv4 address, an IPv6 unique local address, or a loopback address. The reverse proxy in front of the web container must set `X-Real-IP` to the address of the client. For any other peer, nginx uses the address of the peer. A value of `X-Real-IP` that is not an IP address is ignored.
- The 413 and 429 responses of nginx use the `X-Request-ID` request header as the request ID if the header has at most 128 characters and contains only letters, digits, `.`, `_`, and `-`. Otherwise nginx makes the ID. These responses allow every origin and expose `Retry-After` and `X-Request-ID`, as the api does.
- The web container sends the `Content-Security-Policy`, `Permissions-Policy`, and `X-Frame-Options` headers. The build computes the SHA-256 hash of every inline script in `index.html` and writes it into the nginx configuration, so the policy does not allow `unsafe-inline` for scripts. The Swagger UI (`/api`) and ReDoc (`/api/redoc`) pages have a policy of their own that allows the CDNs that FastAPI uses by default. The other `/api` responses have `default-src 'none'`.
- The web container sends `Strict-Transport-Security: max-age=31536000` only when the `X-Forwarded-Proto` request header is `https`. It sets neither `includeSubDomains` nor `preload`.
- A path that is neither a file nor a page of the application gets status 404 with the 404 page of the application. A 404 under `/assets/` has no long-term cache.

### Crawlers

The web container serves `/robots.txt`, `/llms.txt`, and `/llms-full.txt`.

- `/llms.txt` is a short entry in Markdown, for programs such as LLM agents. It is written by hand (`frontend/public/llms.txt`).
- `/llms-full.txt` joins `docs/api.md` and `docs/data-model.md`, with the links between the two documents turned into anchors of the file and the links to other documents rewritten to their GitHub addresses. The build of the web image generates it with `frontend/scripts/llms-full.ts`, so it is not edited by hand, and it always matches the api of the same commit. If `BSLLMNER_VIEWER_COMMIT` is set, the GitHub addresses name that commit. Otherwise, they name `main`.
- If `BSLLMNER_VIEWER_NOINDEX` is `true`, then `/robots.txt` allows only the API, `/llms.txt`, and `/llms-full.txt`, and every response has the header `X-Robots-Tag: noindex`. The API stays open to programs that follow robots.txt.
- Otherwise, `/robots.txt` disallows `/entries` with parameters and the exports. Their combinations are endless, and each of them is a query.
