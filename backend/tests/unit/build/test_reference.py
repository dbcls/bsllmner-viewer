from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from bsllmner_viewer.build.reference import read_bioprojects, read_chip_atlas, read_experiments

type Reader = Callable[[Path], Iterator[tuple[str, str | None]]]


def _write_jsonl(path: Path, docs: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(d) + "\n" for d in docs))


def test_read_chip_atlas_reads_only_lines_whose_first_two_columns_are_not_empty(tmp_path: Path) -> None:
    path = tmp_path / "experimentList.tab"
    path.write_bytes(b"SRX1\thg38\textra\nSRX2\n\thg38\tx\nSRX3\t\tx\nSRX4\tmm10\nSRX5\thg19\xff\xfe\tx\nSRX6\tdm6\n")
    rows = list(read_chip_atlas(path))
    assert [r for r in rows if r[0] != "SRX5"] == [("SRX1", "hg38"), ("SRX4", "mm10"), ("SRX6", "dm6")]
    assert [r[0] for r in rows] == ["SRX1", "SRX4", "SRX5", "SRX6"]


@pytest.mark.parametrize(
    ("reader", "name_a", "name_b", "name_nested", "doc_a", "doc_b", "doc_nested"),
    [
        (
            read_experiments,
            "experiment_1.jsonl",
            "experiment_2.jsonl",
            "experiment_3.jsonl",
            {"identifier": "SRX1", "type": "sra-experiment", "libraryStrategy": ["RNA-Seq"]},
            {"identifier": "SRX2", "type": "sra-experiment", "libraryStrategy": ["ChIP-Seq"]},
            {"identifier": "SRX3", "type": "sra-experiment", "libraryStrategy": ["ATAC-seq"]},
        ),
        (
            read_bioprojects,
            "a.jsonl",
            "b.jsonl",
            "c.jsonl",
            {"identifier": "PRJ1", "title": "one"},
            {"identifier": "PRJ2", "title": "two"},
            {"identifier": "PRJ3", "title": "three"},
        ),
    ],
)
def test_reference_readers_read_every_jsonl_file_under_a_directory_including_nested_ones(
    tmp_path: Path,
    reader: Reader,
    name_a: str,
    name_b: str,
    name_nested: str,
    doc_a: dict[str, object],
    doc_b: dict[str, object],
    doc_nested: dict[str, object],
) -> None:
    _write_jsonl(tmp_path / name_a, [doc_a])
    _write_jsonl(tmp_path / name_b, [doc_b])
    _write_jsonl(tmp_path / "deep" / "er" / name_nested, [doc_nested])
    (tmp_path / "deep" / "notes.txt").write_text("not a jsonl file\n")
    got = sorted(identifier for identifier, _ in reader(tmp_path))
    assert got == sorted(str(d["identifier"]) for d in (doc_a, doc_b, doc_nested))


def test_read_experiments_skips_files_whose_name_has_no_experiment(tmp_path: Path) -> None:
    _write_jsonl(tmp_path / "ncbi_run_0001.jsonl", [{"identifier": "SRX_IN_RUN_FILE", "type": "sra-experiment"}])
    _write_jsonl(tmp_path / "ncbi_sample.jsonl", [{"identifier": "SRX_NO_TYPE"}])
    _write_jsonl(tmp_path / "ncbi_experiment_0001.jsonl", [{"identifier": "SRX1", "type": "sra-experiment"}])
    assert [identifier for identifier, _ in read_experiments(tmp_path)] == ["SRX1"]
