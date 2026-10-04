"""Command line entry point for build operations."""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

import duckdb
import orjson
import yaml

from bsllmner_viewer.build.errors import BuildError
from bsllmner_viewer.build.ingest import build_append, build_full, build_refresh
from bsllmner_viewer.build.manifest import Manifest, load_manifest
from bsllmner_viewer.build.verify import Verification, verify
from bsllmner_viewer.store.version import read_version


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="bsllmner-viewer-build", description="Build a store from a manifest.")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    full = sub.add_parser("full", help="full build from a manifest")
    full.add_argument("--manifest", type=Path, required=True)
    full.add_argument("--out", type=Path, required=True, help="new store file to write")
    full.add_argument("--workers", type=int, default=4, help="processes used to read runs")
    full.add_argument("--threads", type=int, default=None, help="DuckDB threads")

    append = sub.add_parser("append", help="ingest the runs not yet in a store into a new store")
    append.add_argument("--manifest", type=Path, required=True)
    append.add_argument("--store", type=Path, required=True, help="existing store (read only)")
    append.add_argument("--out", type=Path, required=True)
    append.add_argument("--workers", type=int, default=4)
    append.add_argument("--threads", type=int, default=None)

    refresh = sub.add_parser("refresh", help="replace reference data and target assays without re-ingesting runs")
    refresh.add_argument("--manifest", type=Path, required=True)
    refresh.add_argument("--store", type=Path, required=True)
    refresh.add_argument("--out", type=Path, required=True)
    refresh.add_argument("--threads", type=int, default=None)

    ver = sub.add_parser("verify", help="verify a store")
    ver.add_argument("--store", type=Path, required=True)

    info = sub.add_parser("info", help="print the version information of a store")
    info.add_argument("--store", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(asctime)s %(message)s")
    try:
        if args.command == "full":
            result = build_full(_manifest(args.manifest), args.out, workers=args.workers, threads=args.threads)
        elif args.command == "append":
            result = build_append(
                _manifest(args.manifest), args.store, args.out, workers=args.workers, threads=args.threads
            )
        elif args.command == "refresh":
            result = build_refresh(_manifest(args.manifest), args.store, args.out, threads=args.threads)
        elif args.command == "verify":
            result = _read_store(args.store, verify)
        else:
            version = _read_store(args.store, read_version)
            sys.stdout.write(orjson.dumps(version.model_dump(), option=orjson.OPT_INDENT_2).decode() + "\n")
            return 0
    except BuildError as e:
        sys.stderr.write(f"error: {e}\n")
        return 1
    return _report(result)


def _read_store[T](path: Path, read: Callable[[duckdb.DuckDBPyConnection], T]) -> T:
    """Read a store with `read`. A store that DuckDB cannot open, or that lacks the tables of a store, is an error."""
    try:
        con = duckdb.connect(str(path), read_only=True)
    except duckdb.Error as e:
        raise BuildError(f"store {path}: {e}") from e
    try:
        return read(con)
    except duckdb.CatalogException as e:
        raise BuildError(f"store {path} is not a store of this tool: {e}") from e
    finally:
        con.close()


def _manifest(path: Path) -> Manifest:
    try:
        return load_manifest(path)
    except (ValueError, OSError, yaml.YAMLError) as e:
        raise BuildError(f"manifest {path}: {e}") from e


def _report(result: Verification) -> int:
    sys.stdout.write(
        orjson.dumps({"ok": result.ok, "problems": list(result.problems), "counts": result.counts}).decode()
    )
    sys.stdout.write("\n")
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
