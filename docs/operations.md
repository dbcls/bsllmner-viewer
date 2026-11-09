# Operations

This document gives the procedures to build, update, and publish a store of a dataset, to publish an RO-Crate, and to deploy the application. [build.md](build.md) specifies the inputs and the build operations, [deployment.md](deployment.md) describes the deployed containers and their settings, and [development.md](development.md) describes the development environment.

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

## Changing the dataset

Most of the UI takes the values that depend on the dataset, such as the fields, the target assays, and the organisms, from `GET /api/dataset`. Some values of the frontend are written for the current dataset. Before you publish a store of another dataset, for example the results of another model, update these values, and deploy the updated frontend together with the new store:

- `frontend/app/lib/presets.ts`: the example questions and the example heatmaps of the top page, with the labels of the values of each condition. The end-to-end tests check that these labels are the labels that the api returns for each condition.
- `frontend/app/lib/crate.ts`: the RO-Crates that publish the annotations, with their counts, their sizes, their license, and their authors. The Datasets page (`/datasets`) lists these RO-Crates. The Datasets page and the schema.org `Dataset` of the top page take the RO-Crate of the served dataset from this list: the RO-Crate whose model is the `model` of `datasetVersion`. Therefore, if you publish a store of another model, then publish the RO-Crate of that model ([Publishing an RO-Crate](#publishing-an-ro-crate)).
- `frontend/app/shell/footer.tsx`: the place where the annotations were computed.
- `ENTRY_BYTES` in `frontend/app/features/workspace/overlays.tsx`: the size of one entry in a TSV export and in an NDJSON export. The export menu uses these sizes to estimate the size of an export before the download. Measure the sizes on the new store.

## Publishing an RO-Crate

The Datasets page (`/datasets`) offers the RO-Crates that bsllmner-mk2 publishes. The web container serves their files from the datasets directory (`BSLLMNER_VIEWER_DATASETS_DIR`).

To publish an RO-Crate, first choose its release name. The release name is the name of the RO-Crate followed by its `datePublished`, for example `example-ro-crate-2026-10-30`. Then package the RO-Crate:

```
docker compose run --rm --no-deps api uv run bsllmner-viewer-package-crate \
  --crate /data/ro-crate --release example-ro-crate-2026-10-30 --out /data/datasets
```

The command writes these files in the directory of `--out`:

| File | Contents |
|---|---|
| `<release>.tar.gz` | The whole RO-Crate. The archive unpacks into the directory `<release>`. |
| `<release>/<directory>.tar.gz` | One directory at the root of the RO-Crate. The archive keeps the paths from the root of the RO-Crate, so several archives unpack into one tree. |
| `<release>/README.md`, `<release>/ro-crate-metadata.json`, `<release>/provenance/checksums.sha256` | Copies of these files of the RO-Crate, which a reader can open before a download |

- The command reads every archive again, and checks each file against `provenance/checksums.sha256`. If a check fails, then the command prints the error, writes nothing in the directory of `--out`, and exits with status 1. The command also fails if the RO-Crate has a symbolic link, if the list of checksums and the files of the RO-Crate differ, or if the release already exists in the directory of `--out`.
- The command prints the sizes of the archives as JSON.
- An archive does not record the owner of its files, and two runs on the same RO-Crate write the same bytes.

After the command succeeds, follow these steps:

1. Copy the files to the datasets directory of each deployment, and keep their modes ([deployment.md](deployment.md#web-server)).
2. Add the RO-Crate to the list in `frontend/app/lib/crate.ts`, with its counts from the README of the RO-Crate and the sizes that the command printed. Then deploy the frontend.
3. Run the end-to-end tests on the staging site. The tests check that each file that the Datasets page links to exists, and has the size that the page shows.

A release never changes, because the web server lets clients keep its files without asking again. If you make an RO-Crate again, then package it with a new release name. Remove the files of the old release after no deployed frontend links to them.

## Deploying the application

To deploy the application, copy `deploy/.env.example` to `deploy/.env`, and set the variables ([deployment.md](deployment.md#environment-variables)). Then build the images and start the containers:

```
cd deploy
mkdir -p ../log
BSLLMNER_VIEWER_COMMIT=$(git rev-parse --short HEAD) podman-compose -p bsllmner-viewer build --pull
podman-compose -p bsllmner-viewer down
podman-compose -p bsllmner-viewer up -d
```

- Give the project name with `-p` to every podman-compose command, including `ps`, `logs`, `restart`, and `down`. Without `-p`, podman-compose uses the name of the directory, `deploy`, as the project name. You can run the same commands with `docker compose`.
- The Dockerfiles name each base image by a tag without the patch version, and the publisher rebuilds the image of the tag when the image gets security fixes. If you build without `--pull`, then the build uses the base images that are already on the host, and the new images do not get these fixes.
- `up -d` does not rebuild an image that exists, so run `build` after you update the code. podman-compose `up -d` creates the containers again only when the compose configuration has changed, not when an image has changed, so run `down` before `up -d`.
- Create the directory `log` at the root of the checkout before the containers start, because the containers do not start without the directory ([deployment.md](deployment.md#logs)).
- Make the store files and the store directory readable by the user who runs podman. The api runs as root of the container, and with rootless podman, root of the container has only the permissions of the user who runs podman on the host ([deployment.md](deployment.md#containers)).
- With rootless podman, enable lingering for the deploying user (`loginctl enable-linger`), and enable the user service `podman-restart.service` (`systemctl --user enable podman-restart.service`), so that the containers restart after the host reboots.
- A store holds the version of the store schema that build used to write the store. The api starts only with a store of the schema version that the code of the api reads. If an update of the code changes the schema, then write a new store with a full build before you restart the api. `refresh` and `append` reject a store of another schema version.
