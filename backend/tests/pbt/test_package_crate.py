"""Property tests of the command that packages an RO-Crate."""

from __future__ import annotations

import hashlib
import tarfile
import tempfile
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.package_crate import CHECKSUMS, METADATA, README, CrateError, package_crate

RELEASE = "example-ro-crate-2026-10-30"

# Case-insensitive file systems do not matter here, and every generated name is one path component.
NAMES = st.text(alphabet="abcdefgh0123._-", min_size=1, max_size=8).filter(lambda name: name not in {".", ".."})
PATHS = st.lists(NAMES, min_size=1, max_size=3).map("/".join)


def usable(paths: set[str]) -> bool:
    """No path is a directory of another path, and no path takes the place of a file that every RO-Crate has."""
    reserved = {README, METADATA, CHECKSUMS, "provenance"}
    if paths & reserved:
        return False
    return not any(other.startswith(f"{path}/") for path in paths for other in paths)


CONTENTS = st.dictionaries(PATHS, st.binary(max_size=64), max_size=6).filter(lambda files: usable(set(files)))


def write_crate(root: Path, files: dict[str, bytes]) -> Path:
    files = {**files, README: b"# An RO-Crate\n", METADATA: b"{}\n"}
    lines = []
    for path, content in sorted(files.items()):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        if path != METADATA:
            lines.append(f"{hashlib.sha256(content).hexdigest()}  {path}\n")
    checksums = root / CHECKSUMS
    checksums.parent.mkdir(parents=True, exist_ok=True)
    checksums.write_text("".join(lines), encoding="utf-8")
    return root


def members(archive: Path) -> dict[str, bytes]:
    with tarfile.open(archive, mode="r:gz") as tar:
        contents = {}
        for member in tar:
            extracted = tar.extractfile(member)
            assert extracted is not None
            contents[member.name] = extracted.read()
        return contents


@given(files=CONTENTS)
@settings(max_examples=40, deadline=None)
def test_package_crate_any_crate_directory_archives_and_root_files_add_up_to_the_whole_archive(
    files: dict[str, bytes],
) -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        crate = write_crate(root / "crate", files)
        package_crate(crate, RELEASE, root / "out")
        whole = members(root / "out" / f"{RELEASE}.tar.gz")
        on_disk = {path.relative_to(crate).as_posix(): path.read_bytes() for path in crate.rglob("*") if path.is_file()}
        assert whole == {f"{RELEASE}/{path}": content for path, content in on_disk.items()}

        parts: dict[str, bytes] = {}
        for archive in (root / "out" / RELEASE).glob("*.tar.gz"):
            part = archive.name.removesuffix(".tar.gz")
            for name, content in members(archive).items():
                assert name.startswith(f"{part}/")
                assert name not in parts
                parts[name] = content
        assert parts == {path: content for path, content in on_disk.items() if "/" in path}


@given(files=CONTENTS.filter(bool), index=st.integers(min_value=0), flip=st.binary(min_size=1, max_size=8))
@settings(max_examples=40, deadline=None)
def test_package_crate_any_changed_file_writes_nothing(files: dict[str, bytes], index: int, flip: bytes) -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        crate = write_crate(root / "crate", files)
        names = sorted(files)
        target = crate / names[index % len(names)]
        target.write_bytes(target.read_bytes() + flip)
        with pytest.raises(CrateError, match="does not match its checksum"):
            package_crate(crate, RELEASE, root / "out")
        assert list((root / "out").iterdir()) == []
