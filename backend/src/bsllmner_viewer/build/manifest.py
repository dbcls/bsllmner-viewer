"""Manifest: the definition of a dataset."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _duplicates(names: list[str]) -> list[str]:
    return sorted({n for n in names if names.count(n) > 1})


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RunSpec(_Strict):
    name: str
    result: Path
    input: Path
    select_config: Path
    mk2_version: str


class OntologySpec(_Strict):
    """One ontology. Every file (OWL RDF/XML or OBO) contributes terms, labels, synonyms, and parent relations."""

    name: str
    files: list[Path] = Field(min_length=1)
    snapshot_date: str | None = None


class SourceSpec(_Strict):
    path: Path
    snapshot_date: str | None = None


class ReferenceSpec(_Strict):
    ontologies: list[OntologySpec]
    sra_experiments: SourceSpec
    dblink: SourceSpec
    bioprojects: SourceSpec
    chip_atlas: SourceSpec

    @field_validator("ontologies")
    @classmethod
    def _unique_ontology_names(cls, ontologies: list[OntologySpec]) -> list[OntologySpec]:
        duplicates = _duplicates([o.name for o in ontologies])
        if duplicates:
            raise ValueError(f"duplicate ontology names: {', '.join(duplicates)}")
        return ontologies


class Manifest(_Strict):
    name: str
    target_assays: list[str] = Field(min_length=1)
    runs: list[RunSpec] = Field(min_length=1)
    reference: ReferenceSpec
    base_dir: Path = Field(default=Path(), exclude=True)

    @field_validator("runs")
    @classmethod
    def _unique_run_names(cls, runs: list[RunSpec]) -> list[RunSpec]:
        duplicates = _duplicates([r.name for r in runs])
        if duplicates:
            raise ValueError(f"duplicate run names: {', '.join(duplicates)}")
        return runs

    @model_validator(mode="after")
    def _unique_result_files(self) -> Manifest:
        seen: dict[Path, str] = {}
        for run in self.runs:
            resolved = self.resolve(run.result).resolve()
            if resolved in seen:
                raise ValueError(f"runs {seen[resolved]} and {run.name} have the same result file")
            seen[resolved] = run.name
        return self

    def resolve(self, path: Path) -> Path:
        return path if path.is_absolute() else (self.base_dir / path)


def load_manifest(path: Path) -> Manifest:
    """Load a YAML manifest. Relative paths inside it are resolved against the manifest's directory."""
    data: Any = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"manifest {path} must be a mapping")
    return Manifest.model_validate({**data, "base_dir": path.resolve().parent})
