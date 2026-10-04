# Deployment

This document describes what a deployment runs and how the deployment behaves: the containers, their settings, the limits of the api workers and of the web server, health checks, logs, and what crawlers and agents get from the site. [operations.md](operations.md) gives the procedures that deploy the application and publish a store.

## Containers

`deploy/compose.yml` defines two containers:

- `api`: the FastAPI server
- `web`: nginx, which serves the built frontend and passes the requests for `/api` to the api

The frontend is built for the same origin as the api, so the frontend needs no configuration. The browser calls `/api` on the host that served the page.

The build context of the web image is the root of the repository, because the build of the web image also reads `docs/api.md` and `docs/data-model.md` to make `/llms-full.txt`. `.dockerignore` at the root lists only the files to include, so the context has only `frontend/` and these two documents. The api image is the `runtime` stage of `backend/Dockerfile`, which has the packages of the api without the development tools. The `compose.yml` of the development environment builds the `dev` stage of the same file.

Both containers have a read-only root file system and drop every Linux capability. The web container keeps only the capabilities that the nginx master process needs to bind port 80 and to start its workers as the user `nginx`. The api runs as an unprivileged user (uid 10001), and this user does not own the store files.

When the api starts, the api opens the store file that `BSLLMNER_VIEWER_STORE_FILE` names in the store directory, and keeps the file open read-only until the api stops. compose gives the path of this file to the api as `BSLLMNER_VIEWER_STORE`. nginx in the web container looks up the address of the api again every 10 seconds, so the web container does not need a restart when the api container restarts.

Both containers have the restart policy `always`. With rootless podman, the containers restart after the host reboots only if two settings of the deploying user are enabled: lingering, and the user service `podman-restart.service` ([operations.md](operations.md#deploying-the-application)). `podman-restart.service` starts only the containers whose restart policy is `always`.

## Environment variables

A deployment reads the following variables. You set every variable except `BSLLMNER_VIEWER_COMMIT` in `deploy/.env`. Every compose command reads `deploy/.env` automatically. git ignores `deploy/.env`.

| Variable | Meaning |
|---|---|
| `BSLLMNER_VIEWER_STORE_DIR` | Directory holding the store files; mounted read-only at `/data/store` |
| `BSLLMNER_VIEWER_STORE_FILE` | File in that directory to serve (default `current.duckdb`) |
| `BSLLMNER_VIEWER_PORT` | Host port of the web container (default 20081) |
| `BSLLMNER_VIEWER_API_WORKERS` | Number of uvicorn worker processes (default 2); each worker opens the store |
| `BSLLMNER_VIEWER_THREADS` | Number of DuckDB threads per worker (default 8) |
| `BSLLMNER_VIEWER_MEMORY_LIMIT` | DuckDB memory per worker (default `4GB`) |
| `BSLLMNER_VIEWER_MAX_TEMP_SIZE` | Disk space that DuckDB can use per worker for data that does not fit in memory (default `20GB`) |
| `BSLLMNER_VIEWER_QUERY_TIMEOUT` | Seconds that a request can read the store (default 60) |
| `BSLLMNER_VIEWER_MAX_QUERIES` | Maximum number of requests per worker that read the store at the same time, that is, the number of slots ([Limits of a worker](#limits-of-a-worker)) (default 8) |
| `BSLLMNER_VIEWER_MAX_EXPORTS` | Maximum number of exports per worker at the same time (default 2) |
| `BSLLMNER_VIEWER_QUEUE_TIMEOUT` | Seconds that a request waits for a free slot before the api answers 503 (default 10) |
| `BSLLMNER_VIEWER_NOINDEX` | `true` for a deployment that search engines must not index, such as a staging deployment (default `false`) |
| `BSLLMNER_VIEWER_COMMIT` | Commit that the images carry. The footer of the frontend and the version in `/api/service-info` show the commit. Only the build of the images reads this variable, so give it on the command line that builds the images, not in `deploy/.env`. If the variable is not set, then no commit is shown |

## Limits of a worker

Each api worker limits its use of memory, disk, and time, so that one heavy request cannot stop the other requests. The variables of [Environment variables](#environment-variables) set the limits. A size is a number followed by `B`, `KB`, `MB`, `GB`, `TB`, `KiB`, `MiB`, `GiB`, or `TiB`, such as `4GB`. If a limit has a value that is not valid, then the api does not start. [api.md](api.md#limits) describes what a client sees.

- The api configures DuckDB when the api starts, and then locks the configuration. DuckDB can access only the store file and the temporary files of DuckDB, and DuckDB cannot load an extension.
- Memory: if a query needs more memory than `BSLLMNER_VIEWER_MEMORY_LIMIT`, then DuckDB writes the excess to disk. A cross-tabulation that counts BioProjects (`unit=bioproject`) uses several GB even with 10 terms on each axis, so you adjust the limit to the memory of the host. Each worker has its own limit, so the api can use up to the number of workers times the limit, plus the memory of the Python processes, which the limit does not include. The Python process of each worker keeps up to 64 MiB of recent responses ([api.md](api.md#caching)).
- Disk: the store directory is mounted read-only, so DuckDB writes the excess to the volume `api-temp`, which compose mounts at `/var/tmp/bsllmner-viewer`. Each worker uses a directory of its own in the volume, and removes the directory when the worker stops. If the system kills a worker, then the directory of the worker remains, and the next worker that starts in the container removes the directory. The free space of the volume must be at least the number of workers times `BSLLMNER_VIEWER_MAX_TEMP_SIZE`. A tmpfs does not work for the volume, because a tmpfs uses memory. If a worker runs without compose, then `BSLLMNER_VIEWER_TEMP_DIRECTORY` gives a writable directory (default: a directory in the temporary directory of the system).
- Time: [api.md](api.md#limits) describes what the time limit measures. The default of `BSLLMNER_VIEWER_QUERY_TIMEOUT` is longer than the slowest query that the uses in the docs need on the full dataset. If you change the threads or the dataset, then measure that query again on the deployment.
- Concurrency: a request that reads the store takes one of the `BSLLMNER_VIEWER_MAX_QUERIES` slots of its worker. DuckDB shares its threads among the queries of a worker, but every query also adds its own calling thread to the computation. Therefore, the CPU use of a worker grows with the number of concurrent queries. The default of `BSLLMNER_VIEWER_MAX_QUERIES` equals the default of `BSLLMNER_VIEWER_THREADS`. The UI sends many requests at the same time when a view opens, and a request without a slot waits. A worker accepts the running requests, and waiting requests up to four times the number of slots. With fewer than 4 slots, one open view can get 503 responses. More slots do not make a query faster, because the queries share the CPU.
- Exports: an export keeps its database cursor open for as long as the client reads the response, so exports have slots of their own. The worker frees the slot when the response ends or the client disconnects.

## Web server

nginx in the web container adds limits and headers that the api does not set.

- nginx accepts request bodies of up to 64 KiB for `/api`, and answers a request with a larger body with a 413 problem response.
- nginx counts the requests in progress for each client address. If a client has more than 100 requests in progress, then the client gets a 429 problem response with `Retry-After: 1`. If a client has more than 2 exports (`/api/export/`) in progress, then the client gets a 429 problem response with `Retry-After: 10`, because an export holds a slot of the api for minutes. People who share an address share the limits.
- nginx takes the client address from the `X-Real-IP` request header only if the peer address (the address of the host that connects to nginx) is a private IPv4 address, an IPv6 unique local address, or a loopback address. For any other peer, nginx uses the peer address. The reverse proxy in front of the web container must set `X-Real-IP` to the address of the client. nginx ignores a value of `X-Real-IP` that is not an IP address.
- In its 413 and 429 responses, nginx uses the `X-Request-ID` request header as the request ID if the header has at most 128 characters and contains only letters, digits, `.`, `_`, and `-`. Otherwise, nginx makes the request ID. As in the responses of the api, these responses allow every origin, and let browsers read `Retry-After` and `X-Request-ID`.
- The web container sends the `Content-Security-Policy`, `Permissions-Policy`, and `X-Frame-Options` headers. The build of the web image computes the SHA-256 hash of every inline script in `index.html`, and writes the hashes into the nginx configuration. Therefore, the `Content-Security-Policy` does not allow `unsafe-inline` for scripts. The Swagger UI (`/api`) and ReDoc (`/api/redoc`) pages have a policy of their own that allows the CDNs that FastAPI uses by default. The other `/api` responses have `default-src 'none'`.
- The web container sends `Strict-Transport-Security: max-age=31536000`, without `includeSubDomains` or `preload`, only if the `X-Forwarded-Proto` request header is `https`.
- A path that is neither a file nor a page of the application gets status 404 with the 404 page of the application. A 404 response under `/assets/` has no long-term cache.

## Health

`GET /api/service-info` reports the state of the store ([api.md](api.md#service-information)). The health check of the api container calls this endpoint, and `podman ps` shows the container as unhealthy when the check fails. podman restarts a container only when the process of the container ends, not when the check fails. An external monitor should check the same URL on the public host.

## Logs

podman-compose reads `deploy/podman-compose.yml` in addition to `deploy/compose.yml`. With the settings in `deploy/podman-compose.yml`, podman writes the output of each container to a file in the directory `log` at the root of the checkout: `log/api.log` and `log/web.log`. If the directory `log` does not exist, then the containers do not start, and podman reports only that conmon (the monitor process of a podman container) failed. Each line of a log file starts with the time and `stdout` or `stderr`. When compose creates a container again, podman appends to the same file. Before a log file becomes larger than 500 MB, podman empties the file, so only the latest lines remain in the file. docker compose does not read `deploy/podman-compose.yml`, so with docker compose, docker writes the output with its default log driver.

nginx in the web container writes one line to the access log for every request, including the requests for the api. Each line ends with the duration of the request in seconds (`request_time`), the response time of the api in seconds (`upstream_time`), and the request ID of the response (`request_id`). The api writes the lines of uvicorn when the api starts and stops, and also writes its own warnings and errors:

- a query that the time limit or the memory limit stopped
- a response that stopped after the response started, for example an export that a limit stopped after its first page. uvicorn writes the traceback after this line.
- an unhandled exception, with its traceback

Each warning and each error of the api starts with its level, and gives the method, the path, and the request ID. An error response has the same ID in `X-Request-ID` and in `requestId`, so you can find the lines of the request in both logs with this ID. You can also read the logs with `podman-compose -p bsllmner-viewer logs api` and `podman-compose -p bsllmner-viewer logs web`.

## Crawlers and agents

The web container serves `/robots.txt`, `/llms.txt`, and `/llms-full.txt`. Programs expect the OpenAPI document of a FastAPI application at `/openapi.json`, so nginx redirects `/openapi.json` with status 301 to `/api/openapi.json`.

- `/llms.txt` is a short introduction in Markdown, for programs such as agents that use a large language model (LLM), and is written by hand in `frontend/public/llms.txt`.
- `/llms-full.txt` is `docs/api.md` and `docs/data-model.md` in one file. In `/llms-full.txt`, the links between the two documents point to anchors of the file, and the links to other documents point to their GitHub addresses. The build of the web image generates the file with `frontend/scripts/llms-full.ts`, so nobody edits the file by hand, and the file always matches the api of the same commit. If `BSLLMNER_VIEWER_COMMIT` is set, then the GitHub addresses name that commit. Otherwise, the GitHub addresses name `main`.
- If `BSLLMNER_VIEWER_NOINDEX` is `true`, then `/robots.txt` allows only the API, `/llms.txt`, and `/llms-full.txt`, and every response has the header `X-Robots-Tag: noindex`. Programs that follow robots.txt can still use the API.
- Otherwise, `/robots.txt` disallows only `/entries` with query parameters, because the combinations of the parameters are endless, and each combination is a query. Programs that follow robots.txt can use the exports. Every export response has the header `X-Robots-Tag: noindex`, so that search engines do not show an export file in their results when another site links to the export.

Every page of the frontend is the same HTML file ([architecture.md](architecture.md#technology-constraints)). The head of the HTML file gives the name and the description of the site, for programs that read the HTML without running JavaScript, such as the programs that make the previews of shared links. In the browser, each page sets its own title, and also sets its description and its canonical address if the page has them. A page sets `noindex` if the page is an error page, or the page of an accession that is not in the dataset or that could not be loaded. A link to an address that robots.txt disallows has `rel="nofollow"` (`crawlRel` in the frontend). If you change the addresses that robots.txt disallows, then change `crawlRel` in the same way.
