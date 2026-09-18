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
