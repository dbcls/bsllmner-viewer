from __future__ import annotations

from pathlib import Path

import pytest

from bsllmner_viewer.build.manifest import load_manifest
from tests.synthetic import Synthetic


def test_load_manifest_resolves_paths_against_its_directory(synthetic: Synthetic) -> None:
    manifest = load_manifest(synthetic.manifest)
    assert manifest.name == "synthetic"
    assert manifest.target_assays == ["RNA-Seq", "ChIP-Seq", "ATAC-seq"]
    assert manifest.resolve(manifest.runs[0].result) == synthetic.root / "results" / "select_run1.json"
    assert manifest.resolve(manifest.reference.dblink.path).exists()


def test_load_manifest_rejects_duplicate_run_names(synthetic: Synthetic, tmp_path: Path) -> None:
    path = synthetic.manifest_with_runs(["run1", "run1"], tmp_path / "dup.yaml")
    with pytest.raises(ValueError, match="duplicate run names"):
        load_manifest(path)


def test_load_manifest_rejects_unknown_keys(synthetic: Synthetic, tmp_path: Path) -> None:
    path = tmp_path / "extra.yaml"
    path.write_text(synthetic.manifest.read_text() + "unknown_key: 1\n")
    with pytest.raises(ValueError, match="unknown_key"):
        load_manifest(path)


def test_load_manifest_rejects_missing_runs(tmp_path: Path) -> None:
    path = tmp_path / "empty.yaml"
    path.write_text("name: x\ntarget_assays: [RNA-Seq]\nruns: []\nreference:\n  ontologies: []\n")
    with pytest.raises(ValueError, match="runs"):
        load_manifest(path)


_FULL_MANIFEST = """\
name: full
target_assays: [RNA-Seq, WGS]
runs:
  - name: first
    result: results/first.json
    input: inputs/first.jsonl
    select_config: config/first-config.json
    mk2_version: aaa1111
  - name: second
    result: results/second.json
    input: inputs/second.jsonl
    select_config: config/second-config.json
    mk2_version: bbb2222
reference:
  ontologies:
    - name: mondo
      files: [ontology/mondo-a.obo, ontology/mondo-b.owl]
      snapshot_date: "2026-02-01"
    - name: uberon
      files: [ontology/uberon.obo]
  sra_experiments:
    path: reference/sra
    snapshot_date: "2026-03-01"
  dblink:
    path: reference/dblink.duckdb
    snapshot_date: "2026-03-02"
  bioprojects:
    path: reference/bioproject
    snapshot_date: "2026-03-03"
  chip_atlas:
    path: reference/experimentList.tab
"""


def test_load_manifest_reads_every_member_of_the_manifest(tmp_path: Path) -> None:
    path = tmp_path / "manifest.yaml"
    path.write_text(_FULL_MANIFEST)
    manifest = load_manifest(path)
    assert manifest.name == "full"
    assert manifest.target_assays == ["RNA-Seq", "WGS"]
    assert [(r.name, r.result, r.input, r.select_config, r.mk2_version) for r in manifest.runs] == [
        (
            "first",
            Path("results/first.json"),
            Path("inputs/first.jsonl"),
            Path("config/first-config.json"),
            "aaa1111",
        ),
        (
            "second",
            Path("results/second.json"),
            Path("inputs/second.jsonl"),
            Path("config/second-config.json"),
            "bbb2222",
        ),
    ]
    assert [(o.name, o.files, o.snapshot_date) for o in manifest.reference.ontologies] == [
        ("mondo", [Path("ontology/mondo-a.obo"), Path("ontology/mondo-b.owl")], "2026-02-01"),
        ("uberon", [Path("ontology/uberon.obo")], None),
    ]
    reference = manifest.reference
    assert [
        (s.path, s.snapshot_date) for s in (reference.sra_experiments, reference.dblink, reference.bioprojects)
    ] == [
        (Path("reference/sra"), "2026-03-01"),
        (Path("reference/dblink.duckdb"), "2026-03-02"),
        (Path("reference/bioproject"), "2026-03-03"),
    ]
    assert (reference.chip_atlas.path, reference.chip_atlas.snapshot_date) == (
        Path("reference/experimentList.tab"),
        None,
    )


def test_load_manifest_with_another_working_directory_resolves_every_path_against_the_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "dataset"
    root.mkdir()
    (root / "manifest.yaml").write_text(_FULL_MANIFEST)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    manifest = load_manifest(Path("..") / "dataset" / "manifest.yaml")
    base = root.resolve()
    reference = manifest.reference
    resolved = [
        *(manifest.resolve(p) for r in manifest.runs for p in (r.result, r.input, r.select_config)),
        *(manifest.resolve(f) for o in reference.ontologies for f in o.files),
        *(manifest.resolve(s.path) for s in (reference.sra_experiments, reference.dblink, reference.bioprojects)),
        manifest.resolve(reference.chip_atlas.path),
    ]
    assert len(resolved) == 6 + 3 + 4
    assert all(p.parent == base or base in p.parents for p in resolved)
    assert manifest.resolve(manifest.runs[1].select_config) == base / "config" / "second-config.json"
    assert manifest.resolve(reference.chip_atlas.path) == base / "reference" / "experimentList.tab"
