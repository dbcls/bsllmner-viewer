"""Package an RO-Crate into the files that a deployment serves.

The files are an archive of the whole RO-Crate, an archive of each directory at the root of the RO-Crate, and copies of
the files that a reader opens before a download. This module uses only the standard library, so a host without the
package can run the file with its own Python.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import logging
import os
import re
import shutil
import sys
import tarfile
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)

README = "README.md"
METADATA = "ro-crate-metadata.json"
CHECKSUMS = "provenance/checksums.sha256"

# The files that a reader opens before a download.
READ_FIRST = (README, METADATA, CHECKSUMS)

# The list of checksums cannot hold its own digest, and the metadata holds the digests of the list, so the list has
# neither file.
NOT_IN_CHECKSUMS = frozenset({METADATA, CHECKSUMS})

# A release is one component of a path and of an address.
RELEASE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")

CHECKSUM_LINE = re.compile(r"([0-9a-f]{64}) [ *](.+)")

# The worker processes of nginx read the files as another user of the host.
FILE_MODE = 0o644
DIRECTORY_MODE = 0o755

GZIP_LEVEL = 6
CHUNK_BYTES = 1024 * 1024


class CrateError(Exception):
    """The RO-Crate cannot be packaged, or an archive does not hold what the RO-Crate holds."""


class PackagedSizes(TypedDict):
    """The sizes of the archives of a release, in bytes."""

    release: str
    archiveBytes: int
    partBytes: dict[str, int]


def list_files(crate: Path) -> list[str]:
    """The paths of the files of an RO-Crate from its root, sorted. An RO-Crate holds only regular files."""
    if not crate.is_dir():
        raise CrateError(f"{crate} is not a directory")
    paths: list[str] = []
    for directory, subdirectories, names in os.walk(crate):
        for name in subdirectories:
            if Path(directory, name).is_symlink():
                raise CrateError(f"{Path(directory, name).relative_to(crate)} is a symbolic link")
        for name in names:
            path = Path(directory, name)
            relative = path.relative_to(crate)
            if path.is_symlink():
                raise CrateError(f"{relative} is a symbolic link")
            if not path.is_file():
                raise CrateError(f"{relative} is not a regular file")
            paths.append(relative.as_posix())
    return sorted(paths)


def read_checksums(crate: Path) -> dict[str, str]:
    """The digest of each file in the list of checksums of an RO-Crate, by its path from the root."""
    digests: dict[str, str] = {}
    for number, line in enumerate((crate / CHECKSUMS).read_text(encoding="utf-8").splitlines(), start=1):
        match = CHECKSUM_LINE.fullmatch(line)
        if match is None:
            raise CrateError(f"{CHECKSUMS}:{number} is not a checksum line")
        digests[match[2].removeprefix("./")] = match[1]
    return digests


def check_listed(files: Sequence[str], digests: Mapping[str, str]) -> None:
    """Fail unless the list of checksums names exactly the files of the RO-Crate that it can hold."""
    expected = set(files) - NOT_IN_CHECKSUMS
    missing = sorted(expected - digests.keys())
    if missing:
        raise CrateError(f"{CHECKSUMS} does not list {missing[0]} ({len(missing)} files)")
    absent = sorted(digests.keys() - expected)
    if absent:
        raise CrateError(f"{CHECKSUMS} lists {absent[0]}, which the RO-Crate does not hold ({len(absent)} files)")


def file_digest(path: Path) -> str:
    with path.open("rb") as content:
        return hashlib.file_digest(content, "sha256").hexdigest()


def write_archive(path: Path, members: Sequence[tuple[str, Path]]) -> None:
    """Write a gzipped tar of the members, as pairs of a name and a source file.

    The archive records no owner and the gzip header no time, so that two runs on the same files write the same bytes.
    """
    with (
        path.open("wb") as raw,
        gzip.GzipFile(filename="", mode="wb", compresslevel=GZIP_LEVEL, fileobj=raw, mtime=0) as compressed,
        tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as tar,
    ):
        for name, source in members:
            status = source.stat()
            info = tarfile.TarInfo(name)
            info.size = status.st_size
            info.mtime = int(status.st_mtime)
            info.mode = FILE_MODE
            with source.open("rb") as content:
                tar.addfile(info, content)


def check_archive(path: Path, expected: Mapping[str, str]) -> None:
    """Read an archive again, and fail unless it holds exactly the expected members with the expected digests."""
    seen: set[str] = set()
    with tarfile.open(path, mode="r|gz") as tar:
        for member in tar:
            content = tar.extractfile(member) if member.isfile() else None
            if content is None or member.name not in expected or member.name in seen:
                raise CrateError(f"{path.name} has an unexpected member {member.name}")
            digest = hashlib.sha256()
            while chunk := content.read(CHUNK_BYTES):
                digest.update(chunk)
            if digest.hexdigest() != expected[member.name]:
                raise CrateError(f"{member.name} in {path.name} does not match its checksum")
            seen.add(member.name)
    missing = sorted(expected.keys() - seen)
    if missing:
        raise CrateError(f"{path.name} does not hold {missing[0]} ({len(missing)} files)")


def directories_at_root(files: Sequence[str]) -> list[str]:
    return sorted({path.split("/", 1)[0] for path in files if "/" in path})


def package_crate(crate: Path, release: str, out: Path) -> PackagedSizes:
    """Write the files of a release in the directory `out`, and return the sizes of the archives.

    The files appear in `out` only after every archive has passed its check. The working directory in `out` has mode
    700, so that a web server that serves `out` cannot serve a file that is not checked yet.
    """
    if RELEASE_PATTERN.fullmatch(release) is None:
        raise CrateError(f"{release!r} is not a release name")
    files = list_files(crate)
    for path in READ_FIRST:
        if path not in files:
            raise CrateError(f"the RO-Crate does not hold {path}")
    listed = read_checksums(crate)
    check_listed(files, listed)
    digests = {**listed, **{path: file_digest(crate / path) for path in NOT_IN_CHECKSUMS}}

    folder = out / release
    archive = out / f"{release}.tar.gz"
    for target in (folder, archive):
        if target.exists():
            raise CrateError(f"{target} already exists")

    out.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=f".{release}.", dir=out))
    try:
        work_folder = work / release
        work_folder.mkdir()
        work_archive = work / archive.name

        logger.info("writing %s", archive.name)
        write_archive(work_archive, [(f"{release}/{path}", crate / path) for path in files])
        check_archive(work_archive, {f"{release}/{path}": digests[path] for path in files})

        part_bytes: dict[str, int] = {}
        for part in directories_at_root(files):
            paths = [path for path in files if path.startswith(f"{part}/")]
            logger.info("writing %s/%s.tar.gz", release, part)
            part_archive = work_folder / f"{part}.tar.gz"
            write_archive(part_archive, [(path, crate / path) for path in paths])
            check_archive(part_archive, {path: digests[path] for path in paths})
            part_archive.chmod(FILE_MODE)
            part_bytes[part] = part_archive.stat().st_size

        for path in READ_FIRST:
            copy = work_folder / path
            copy.parent.mkdir(parents=True, exist_ok=True)
            copy.parent.chmod(DIRECTORY_MODE)
            shutil.copyfile(crate / path, copy)
            copy.chmod(FILE_MODE)
            if file_digest(copy) != digests[path]:
                raise CrateError(f"the copy of {path} does not match its checksum")

        work_folder.chmod(DIRECTORY_MODE)
        work_archive.chmod(FILE_MODE)
        archive_bytes = work_archive.stat().st_size
        work_folder.replace(folder)
        work_archive.replace(archive)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return {"release": release, "archiveBytes": archive_bytes, "partBytes": part_bytes}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="bsllmner-viewer-package-crate",
        description="Package an RO-Crate into the files that a deployment serves, and print the sizes of the archives.",
    )
    parser.add_argument("--crate", type=Path, required=True, help="directory of the RO-Crate (read only)")
    parser.add_argument("--release", required=True, help="release name, for example example-ro-crate-2026-10-30")
    parser.add_argument("--out", type=Path, required=True, help="directory to write the files of the release in")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stderr)
    try:
        sizes = package_crate(args.crate, args.release, args.out)
    except (CrateError, OSError, tarfile.TarError) as error:
        sys.stderr.write(f"error: {error}\n")
        return 1
    sys.stdout.write(json.dumps(sizes, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
