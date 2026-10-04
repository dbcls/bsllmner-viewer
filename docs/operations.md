# Operations

This document gives the procedures to build, update, and publish a store of a dataset, and to deploy the application. [build.md](build.md) specifies the inputs and the build operations, [deployment.md](deployment.md) describes the deployed containers and their settings, and [development.md](development.md) describes the development environment.

## Building a store

You run the `bsllmner-viewer-build` command of the backend package inside the api container of the development environment ([development.md](development.md)). The manifest ([build.md](build.md#manifest)) and every input that the manifest refers to must be visible inside the container. With `compose.yml`, compose mounts the data directory (`BSLLMNER_VIEWER_DATA_DIR`) at `/data`. You cannot build a store in the api container of `deploy/compose.yml`, because `deploy/compose.yml` mounts only the store directory into the container, and mounts it read-only.

```
docker compose run --rm --no-deps api uv run bsllmner-viewer-build full \
  --manifest /data/manifests/dataset.yaml --out /data/store/dataset-2026-09-30.duckdb --workers 6
```

- `full` reads all runs and all sources of reference data in the manifest, and writes a new store file. The output path must not exist.
- `--workers` is the number of processes that read the run results and find the evidence of the run results in parallel. Each process holds one result file in memory (up to a few GB for the largest files).
- `full`, `append`, `refresh`, and `verify` print the verification result as JSON, and exit with status 1 if the verification fails. A build whose verification fails still writes its store file. Therefore, publish a store only after the verification of the store passes. If an input is invalid, then the command prints the error and exits with status 1.

## Appending runs

To append runs to a store, add the new runs to the end of the list of runs in the manifest, and then run `append` with the current store as `--store`:

```
docker compose run --rm --no-deps api uv run bsllmner-viewer-build append \
  --manifest /data/manifests/dataset.yaml --store /data/store/current.duckdb --out /data/store/dataset-2026-10-31.duckdb
```

In the manifest, the runs that are already in the store must come first, in the same order as in the store. `append` reads the reference data of the manifest again, so that the new BioSamples get their relations.

## Refreshing reference data or target assays

To refresh the reference data or the target assays of a store, update the reference section or the target assays of the manifest, and then run `refresh`:

```
docker compose run --rm --no-deps api uv run bsllmner-viewer-build refresh \
  --manifest /data/manifests/dataset.yaml --store /data/store/current.duckdb --out /data/store/dataset-2026-11-05.duckdb
```

The manifest must list exactly the runs of the store, in the same order. To add runs, use `append`.

## Verifying and inspecting a store

To verify a store, run `verify`. To print the version information of a store, run `info`:

```
docker compose run --rm --no-deps api uv run bsllmner-viewer-build verify --store /data/store/dataset-2026-09-30.duckdb
docker compose run --rm --no-deps api uv run bsllmner-viewer-build info --store /data/store/dataset-2026-09-30.duckdb
```

`info` prints the dataset version information of the store as JSON. `GET /api/dataset` returns the same information in its `version` property, with camelCase keys instead of snake_case keys.

## Publishing a store

To publish a store, you switch the file that the api opens:

1. Build and verify the new store file in the same directory as the current store file.
2. Make the api open the new file: point the `current.duckdb` symlink to the new file, and restart the api container (`podman-compose -p bsllmner-viewer restart api`). If you change `BSLLMNER_VIEWER_STORE_FILE` in `deploy/.env` instead of the symlink, then run `down` and `up -d`, because a restart keeps the environment that the container was created with. The web container does not need a restart ([deployment.md](deployment.md#containers)).
3. Keep the previous file until you have checked the new file in the UI. To revert, switch back to the previous file in the same way.

The api reads the file that it opened at startup until the api stops. Therefore, until the restart, `/api/service-info` reports the state of the previous file. If the api cannot open the new file, for example because the file has another schema version or because the api cannot read the file, then the api does not start. In that case, `/api` answers 502 until you switch the api back to the previous file.

A store file that the api serves is never modified. You can delete an old file when no api process has the file open. The `ETag` of an api response depends on the store, on the files of the api package, and on the installed Python packages ([api.md](api.md#caching)). Therefore, after you switch the store, update the code, or update a dependency, clients get the new responses and not the responses that they kept.

## Deploying the application

To deploy the application, copy `deploy/.env.example` to `deploy/.env`, and set the variables ([deployment.md](deployment.md#environment-variables)). Then build the images and start the containers:

```
cd deploy
mkdir -p ../log
BSLLMNER_VIEWER_COMMIT=$(git rev-parse --short HEAD) podman-compose -p bsllmner-viewer build
podman-compose -p bsllmner-viewer down
podman-compose -p bsllmner-viewer up -d
```

- Give the project name with `-p` to every podman-compose command, including `ps`, `logs`, `restart`, and `down`. Without `-p`, podman-compose uses the name of the directory, `deploy`, as the project name. You can run the same commands with `docker compose`.
- `up -d` does not rebuild an image that exists, so run `build` after you update the code. podman-compose `up -d` creates the containers again only when the compose configuration has changed, not when an image has changed, so run `down` before `up -d`.
- Create the directory `log` at the root of the checkout before the containers start, because the containers do not start without the directory ([deployment.md](deployment.md#logs)).
- Make every store file readable by all users (for example mode 644), and make the store directory readable and searchable by all users, because the user of the api does not own the store files or the store directory ([deployment.md](deployment.md#containers)). With rootless podman, a user other than root in the container is a different user on the host.
- With rootless podman, enable lingering for the deploying user (`loginctl enable-linger`), and enable the user service `podman-restart.service` (`systemctl --user enable podman-restart.service`), so that the containers restart after the host reboots.
- A store holds the version of the store schema that build used to write the store. The api starts only with a store of the schema version that the code of the api reads. If an update of the code changes the schema, then write a new store with a full build before you restart the api. `refresh` and `append` reject a store of another schema version.
