"""Unit tests of the command that packages an RO-Crate."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import tarfile
from pathlib import Path

import pytest

from bsllmner_viewer.package_crate import CHECKSUMS, METADATA, README, CrateError, main, package_crate

RELEASE = "example-ro-crate-2026-10-30"

FILES = {
    README: b"# An RO-Crate\n",
    METADATA: b'{"@graph": []}\n',
    "results/stream/stream_2020.jsonl": b'{"accession": "SAMD00000001"}\n',
    "results/stream/stream_unknown.jsonl": b"",
    "run-results/select_a.json": b"{}\n" * 1000,
    "inputs/stream/bs_entries.jsonl": b"{}\n",
    "provenance/run_index.tsv": b"run_name\n",
}


def write_crate(root: Path, files: dict[str, bytes] = FILES) -> Path:
    """Write an RO-Crate with its list of checksums, which holds every file except itself and the metadata."""
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


def crate_contents(crate: Path) -> dict[str, bytes]:
    return {path.relative_to(crate).as_posix(): path.read_bytes() for path in crate.rglob("*") if path.is_file()}


def tree(root: Path) -> list[Path]:
    return sorted(root.rglob("*"))


def test_package_crate_whole_archive_holds_every_file_under_the_release(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    package_crate(crate, RELEASE, tmp_path / "out")
    expected = {f"{RELEASE}/{path}": content for path, content in crate_contents(crate).items()}
    assert members(tmp_path / "out" / f"{RELEASE}.tar.gz") == expected


def test_package_crate_directory_archives_hold_each_directory_with_paths_from_the_root(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    package_crate(crate, RELEASE, tmp_path / "out")
    folder = tmp_path / "out" / RELEASE
    contents = crate_contents(crate)
    for part in ("results", "run-results", "inputs", "provenance"):
        expected = {path: content for path, content in contents.items() if path.startswith(f"{part}/")}
        assert expected
        assert members(folder / f"{part}.tar.gz") == expected


def test_package_crate_file_at_the_root_is_only_in_the_whole_archive(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate", {**FILES, "LICENSE": b"text\n"})
    package_crate(crate, RELEASE, tmp_path / "out")
    assert f"{RELEASE}/LICENSE" in members(tmp_path / "out" / f"{RELEASE}.tar.gz")
    folder = tmp_path / "out" / RELEASE
    assert not (folder / "LICENSE").exists()
    assert sorted(path.name for path in folder.glob("*.tar.gz")) == [
        "inputs.tar.gz",
        "provenance.tar.gz",
        "results.tar.gz",
        "run-results.tar.gz",
    ]


def test_package_crate_copies_the_files_that_a_reader_opens_first(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    package_crate(crate, RELEASE, tmp_path / "out")
    for path in (README, METADATA, CHECKSUMS):
        assert (tmp_path / "out" / RELEASE / path).read_bytes() == (crate / path).read_bytes()


def test_package_crate_returns_the_sizes_of_the_files_on_disk(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    sizes = package_crate(crate, RELEASE, tmp_path / "out")
    assert sizes["release"] == RELEASE
    assert sizes["archiveBytes"] == (tmp_path / "out" / f"{RELEASE}.tar.gz").stat().st_size
    folder = tmp_path / "out" / RELEASE
    assert sizes["partBytes"] == {
        path.name.removesuffix(".tar.gz"): path.stat().st_size for path in folder.glob("*.tar.gz")
    }


def test_package_crate_output_is_readable_by_other_users_under_a_strict_umask(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    previous = os.umask(0o077)
    try:
        package_crate(crate, RELEASE, tmp_path / "out")
    finally:
        os.umask(previous)
    for path in tree(tmp_path / "out"):
        mode = stat.S_IMODE(path.stat().st_mode)
        assert mode == (0o755 if path.is_dir() else 0o644), path


def test_package_crate_two_runs_write_the_same_bytes(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    package_crate(crate, RELEASE, tmp_path / "one")
    package_crate(crate, RELEASE, tmp_path / "two")
    for path in tree(tmp_path / "one"):
        if path.is_file():
            assert path.read_bytes() == (tmp_path / "two" / path.relative_to(tmp_path / "one")).read_bytes(), path


def test_package_crate_archives_record_no_owner(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    package_crate(crate, RELEASE, tmp_path / "out")
    with tarfile.open(tmp_path / "out" / f"{RELEASE}.tar.gz", mode="r:gz") as tar:
        for member in tar:
            assert (member.uid, member.gid, member.uname, member.gname) == (0, 0, "", "")
            assert member.mode == 0o644


def test_package_crate_checksum_with_a_leading_dot_slash_is_the_same_path(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    checksums = crate / CHECKSUMS
    lines = checksums.read_text(encoding="utf-8").splitlines()
    checksums.write_text("".join(line.replace("  ", "  ./", 1) + "\n" for line in lines), encoding="utf-8")
    package_crate(crate, RELEASE, tmp_path / "out")
    assert (tmp_path / "out" / f"{RELEASE}.tar.gz").exists()


def assert_refused(crate: Path, out: Path, message: str) -> None:
    """The command fails with the message, and leaves nothing in the output directory."""
    with pytest.raises(CrateError, match=message):
        package_crate(crate, RELEASE, out)
    assert not out.exists() or tree(out) == []


def test_package_crate_file_that_differs_from_its_checksum_writes_nothing(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    (crate / "inputs/stream/bs_entries.jsonl").write_bytes(b"changed\n")
    assert_refused(crate, tmp_path / "out", "does not match its checksum")


def test_package_crate_file_missing_from_the_checksums_is_refused(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    (crate / "results/extra.jsonl").write_bytes(b"\n")
    assert_refused(crate, tmp_path / "out", "does not list results/extra.jsonl")


def test_package_crate_checksum_of_a_file_that_is_gone_is_refused(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    (crate / "inputs/stream/bs_entries.jsonl").unlink()
    assert_refused(crate, tmp_path / "out", "does not hold")


def test_package_crate_malformed_checksum_line_is_refused(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    (crate / CHECKSUMS).write_text("not a digest  README.md\n", encoding="utf-8")
    assert_refused(crate, tmp_path / "out", "not a checksum line")


@pytest.mark.parametrize("path", [README, METADATA, CHECKSUMS])
def test_package_crate_without_a_file_to_read_first_is_refused(tmp_path: Path, path: str) -> None:
    crate = write_crate(tmp_path / "crate")
    (crate / path).unlink()
    assert_refused(crate, tmp_path / "out", f"does not hold {path}")


def test_package_crate_symbolic_link_to_a_file_is_refused(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    (crate / "results/link.jsonl").symlink_to(crate / README)
    assert_refused(crate, tmp_path / "out", "symbolic link")


def test_package_crate_symbolic_link_to_a_directory_is_refused(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    (crate / "results/link").symlink_to(crate / "inputs", target_is_directory=True)
    assert_refused(crate, tmp_path / "out", "symbolic link")


def test_package_crate_existing_release_is_refused_and_kept(tmp_path: Path) -> None:
    crate = write_crate(tmp_path / "crate")
    out = tmp_path / "out"
    package_crate(crate, RELEASE, out)
    before = {path: path.read_bytes() for path in tree(out) if path.is_file()}
    with pytest.raises(CrateError, match="already exists"):
        package_crate(crate, RELEASE, out)
    assert {path: path.read_bytes() for path in tree(out) if path.is_file()} == before


@pytest.mark.parametrize("release", ["", ".", "..", ".hidden", "a/b", "../a", "a b", "a\n", "-a"])
def test_package_crate_release_that_is_not_one_path_component_is_refused(tmp_path: Path, release: str) -> None:
    crate = write_crate(tmp_path / "crate")
    with pytest.raises(CrateError, match="not a release name"):
        package_crate(crate, release, tmp_path / "out")
    assert not (tmp_path / "out").exists()


def test_package_crate_directory_that_does_not_exist_is_refused(tmp_path: Path) -> None:
    with pytest.raises(CrateError, match="not a directory"):
        package_crate(tmp_path / "missing", RELEASE, tmp_path / "out")


def test_main_prints_the_sizes_as_json_and_exits_with_status_0(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    crate = write_crate(tmp_path / "crate")
    status = main(["--crate", str(crate), "--release", RELEASE, "--out", str(tmp_path / "out")])
    assert status == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["release"] == RELEASE
    assert printed["archiveBytes"] == (tmp_path / "out" / f"{RELEASE}.tar.gz").stat().st_size


def test_main_refused_crate_prints_the_error_and_exits_with_status_1(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    status = main(["--crate", str(tmp_path / "missing"), "--release", RELEASE, "--out", str(tmp_path / "out")])
    captured = capsys.readouterr()
    assert status == 1
    assert captured.out == ""
    assert "not a directory" in captured.err
