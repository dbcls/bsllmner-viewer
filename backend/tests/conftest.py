from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, settings

from bsllmner_viewer.api.app import create_app
from bsllmner_viewer.build.ingest import build_full
from bsllmner_viewer.build.manifest import load_manifest
from tests.synthetic import Synthetic, generate

settings.register_profile("default", suppress_health_check=[HealthCheck.too_slow], deadline=None)
settings.load_profile("default")


@pytest.fixture(scope="session")
def synthetic(tmp_path_factory: pytest.TempPathFactory) -> Synthetic:
    return generate(tmp_path_factory.mktemp("synthetic"), seed=1, n_biosamples=160, n_runs=3)


@pytest.fixture(scope="session")
def store_path(synthetic: Synthetic) -> Path:
    out = synthetic.root / "store" / "full.duckdb"
    result = build_full(load_manifest(synthetic.manifest), out, workers=1)
    assert result.ok, result.problems
    return out


@pytest.fixture(scope="session")
def store_con(store_path: Path) -> Iterator[duckdb.DuckDBPyConnection]:
    con = duckdb.connect(str(store_path), read_only=True)
    yield con
    con.close()


@pytest.fixture(scope="session")
def client(store_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(store_path)) as client:
        yield client
