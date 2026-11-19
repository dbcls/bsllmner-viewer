from __future__ import annotations

import hashlib
import json
import shutil
from collections.abc import Callable
from pathlib import Path

import duckdb
import pytest

from bsllmner_viewer.build.errors import BuildError
from bsllmner_viewer.build.ingest import build_append, build_full, build_refresh
from bsllmner_viewer.build.manifest import load_manifest
from bsllmner_viewer.build.verify import Verification
from bsllmner_viewer.store.schema import DERIVED_TABLES, RAW_TABLES
from bsllmner_viewer.store.version import read_version
from tests.synthetic import FIELDS, Synthetic, generate

# What differs between a store that excludes a field and a store whose select configuration lacks the field.
_CONFIG_DEPENDENT = {"store_meta": "excluded_fields", "run": "select_config_sha256"}


def _excluding(manifest: Path, fields: list[str], out: Path) -> Path:
    """A copy of a manifest with `excluded_fields`."""
    head, _, tail = manifest.read_text().partition("runs:\n")
    out.write_text(f"{head}excluded_fields: {json.dumps(fields)}\nruns:\n{tail}")
    return out


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _names(directory: Path) -> list[str]:
    return sorted(p.name for p in directory.iterdir()) if directory.exists() else []


def _snapshot(path: Path, *, config_dependent: bool = True) -> dict[str, list[tuple[object, ...]]]:
    """Every table of a store without the times of the build, and optionally without `_CONFIG_DEPENDENT`."""
    con = duckdb.connect(str(path), read_only=True)
    try:
        out: dict[str, list[tuple[object, ...]]] = {}
        for table in (*RAW_TABLES, *DERIVED_TABLES):
            if table == "store_meta":
                skipped = ["created_at"] if config_dependent else ["created_at", _CONFIG_DEPENDENT["store_meta"]]
                rows = con.execute(
                    f"SELECT key, value FROM store_meta WHERE key NOT IN ({', '.join('?' for _ in skipped)})", skipped
                ).fetchall()
            else:
                skipped = ["ingested_at"] if config_dependent else ["ingested_at", _CONFIG_DEPENDENT.get(table, "")]
                columns = [c[0] for c in con.execute(f"DESCRIBE {table}").fetchall() if c[0] not in skipped]
                rows = con.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
            out[table] = sorted(rows, key=repr)
        return out
    finally:
        con.close()


def _rows_of_field(path: Path, field: str) -> dict[str, int]:
    """The number of rows that name the field, for every table with a `field` column or a field `name`."""
    con = duckdb.connect(str(path), read_only=True)
    try:
        counts: dict[str, int] = {}
        for table in (*RAW_TABLES, *DERIVED_TABLES):
            columns = {str(c[0]) for c in con.execute(f"DESCRIBE {table}").fetchall()}
            column = "name" if table == "field" else "field" if "field" in columns else None
            if column is not None:
                row = con.execute(f"SELECT count(*) FROM {table} WHERE {column} = ?", [field]).fetchone()
                assert row is not None
                counts[table] = int(row[0])
        return counts
    finally:
        con.close()


def _field_names(path: Path) -> list[str]:
    con = duckdb.connect(str(path), read_only=True)
    try:
        return [str(r[0]) for r in con.execute("SELECT name FROM field ORDER BY position").fetchall()]
    finally:
        con.close()


def _without_fields(root: Path, fields: set[str]) -> None:
    """Remove fields from the select configuration of the dataset. The results keep the values of the fields."""
    config = root / "config" / "select-config.json"
    kept = {name: spec for name, spec in json.loads(config.read_text())["fields"].items() if name not in fields}
    config.write_text(json.dumps({"fields": kept}))


@pytest.fixture
def syn(tmp_path: Path) -> Synthetic:
    return generate(tmp_path / "syn", seed=3, n_biosamples=24, n_runs=3)


def _full(manifest: Path, out: Path) -> Path:
    result = build_full(load_manifest(manifest), out, workers=1)
    assert result.ok, result.problems
    return out


def test_full_build_without_excluded_fields_stores_rows_of_every_field(syn: Synthetic, tmp_path: Path) -> None:
    store = _full(syn.manifest, tmp_path / "all.duckdb")
    assert _field_names(store) == list(FIELDS)
    for field in FIELDS:
        counts = _rows_of_field(store, field)
        assert counts["field"] == 1
        assert counts["entry_annotation"] > 0
        assert counts["annotation"] > 0
        assert counts["evidence"] > 0


@pytest.mark.parametrize("excluded", [["chip_antigen"], ["cell_line"], ["drug", "disease"], list(FIELDS)])
def test_full_build_with_excluded_fields_stores_no_row_of_the_fields_and_keeps_the_order_of_the_others(
    syn: Synthetic, tmp_path: Path, excluded: list[str]
) -> None:
    store = _full(_excluding(syn.manifest, excluded, syn.root / "excluding.yaml"), tmp_path / "excluding.duckdb")
    assert _field_names(store) == [f for f in FIELDS if f not in excluded]
    for field in excluded:
        assert set(_rows_of_field(store, field).values()) == {0}, field


@pytest.mark.parametrize("excluded", [["chip_antigen"], ["drug", "disease"], list(FIELDS)])
def test_full_build_with_excluded_fields_equals_a_build_whose_select_configuration_lacks_the_fields(
    syn: Synthetic, tmp_path: Path, excluded: list[str]
) -> None:
    excluding = _full(_excluding(syn.manifest, excluded, syn.root / "excluding.yaml"), tmp_path / "excluding.duckdb")
    everything = _full(syn.manifest, tmp_path / "everything.duckdb")
    _without_fields(syn.root, set(excluded))
    lacking = _full(syn.manifest, tmp_path / "lacking.duckdb")
    assert _snapshot(excluding, config_dependent=False) == _snapshot(lacking, config_dependent=False)
    assert _snapshot(excluding, config_dependent=False) != _snapshot(everything, config_dependent=False)


def test_full_build_with_an_excluded_field_leaves_the_values_of_the_field_out_of_the_searchable_text(
    tmp_path: Path,
) -> None:
    syn = generate(tmp_path / "syn", seed=3, n_biosamples=24, n_runs=1)
    marker = "zzantigenzz"
    path = syn.root / "results" / "select_run1.json"
    body = json.loads(path.read_text())
    entry = next(e for e in body["entries"] if e["extract"]["extracted"] is not None)
    entry["extract"]["extracted"]["chip_antigen"] = [marker]
    path.write_text(json.dumps(body))
    accession = entry["extract"]["accession"]

    def text(store: Path) -> str:
        con = duckdb.connect(str(store), read_only=True)
        try:
            row = con.execute("SELECT text FROM searchable_text WHERE biosample = ?", [accession]).fetchone()
        finally:
            con.close()
        assert row is not None
        return str(row[0])

    assert marker in text(_full(syn.manifest, tmp_path / "everything.duckdb"))
    excluding = _excluding(syn.manifest, ["chip_antigen"], syn.root / "excluding.yaml")
    assert marker not in text(_full(excluding, tmp_path / "excluding.duckdb"))


@pytest.mark.parametrize(
    ("excluded", "named"),
    [
        (["chip_antigens"], "'chip_antigens'"),
        (["CHIP_ANTIGEN"], "'CHIP_ANTIGEN'"),
        ([" chip_antigen"], "' chip_antigen'"),
        ([""], "''"),
        (["chip_antigen", "no_such_field"], "'no_such_field'"),
        (["no_such_field", "chip_antigen", "another"], "'another', 'no_such_field'"),
        (["library_strategy"], "'library_strategy'"),
    ],
)
def test_full_build_with_an_excluded_field_that_no_select_configuration_has_is_rejected_and_leaves_no_file(
    syn: Synthetic, tmp_path: Path, excluded: list[str], named: str
) -> None:
    manifest = _excluding(syn.manifest, excluded, syn.root / "excluding.yaml")
    out = tmp_path / "out" / "store.duckdb"
    with pytest.raises(BuildError, match="not in the select configuration of any run") as error:
        build_full(load_manifest(manifest), out, workers=1)
    assert str(error.value).endswith(f": {named}")
    assert _names(out.parent) == []


def test_full_build_with_the_same_excluded_fields_repeated_and_in_another_order_gives_the_same_store(
    syn: Synthetic, tmp_path: Path
) -> None:
    first = _full(_excluding(syn.manifest, ["chip_antigen", "drug"], syn.root / "a.yaml"), tmp_path / "a.duckdb")
    second = _full(
        _excluding(syn.manifest, ["drug", "chip_antigen", "drug"], syn.root / "b.yaml"), tmp_path / "b.duckdb"
    )
    assert _snapshot(first) == _snapshot(second)


def _with_a_second_configuration(syn: Synthetic, fields: dict[str, dict[str, object]]) -> Path:
    """A manifest whose last run reads a select configuration with other fields."""
    (syn.root / "config" / "second-config.json").write_text(json.dumps({"fields": fields}))
    head, last, tail = syn.manifest.read_text().rpartition("config/select-config.json")
    out = syn.root / "two-configs.yaml"
    out.write_text(head + last.replace("select-config.json", "second-config.json") + tail)
    return out


def test_full_build_with_an_excluded_field_of_only_one_select_configuration_is_accepted(
    syn: Synthetic, tmp_path: Path
) -> None:
    second: dict[str, dict[str, object]] = {**{k: v for k, v in FIELDS.items() if k != "chip_antigen"}, "treatment": {}}
    manifest = _with_a_second_configuration(syn, second)
    assert _field_names(_full(manifest, tmp_path / "everything.duckdb")) == [*FIELDS, "treatment"]
    only_last = _excluding(manifest, ["treatment"], syn.root / "only-last.yaml")
    assert _field_names(_full(only_last, tmp_path / "only-last.duckdb")) == list(FIELDS)
    only_first = _excluding(manifest, ["chip_antigen"], syn.root / "only-first.yaml")
    store = _full(only_first, tmp_path / "only-first.duckdb")
    assert _field_names(store) == [*(f for f in FIELDS if f != "chip_antigen"), "treatment"]
    assert set(_rows_of_field(store, "chip_antigen").values()) == {0}


def test_full_build_with_an_excluded_field_ignores_a_difference_in_the_value_type_of_the_field(
    syn: Synthetic, tmp_path: Path
) -> None:
    single_valued: dict[str, object] = {"ontology_file": "ontology/gene.obo", "value_type": "string"}
    manifest = _with_a_second_configuration(syn, {**FIELDS, "chip_antigen": single_valued})
    with pytest.raises(BuildError, match="single-valued in one run and multi-valued in another"):
        build_full(load_manifest(manifest), tmp_path / "everything.duckdb", workers=1)
    excluding = _excluding(manifest, ["chip_antigen"], syn.root / "excluding.yaml")
    assert "chip_antigen" not in _field_names(_full(excluding, tmp_path / "excluding.duckdb"))


def _version_excluded(path: Path) -> list[str]:
    con = duckdb.connect(str(path), read_only=True)
    try:
        return read_version(con).excluded_fields
    finally:
        con.close()


def test_read_version_returns_the_excluded_fields_of_the_manifest_once_each_in_sorted_order(
    syn: Synthetic, tmp_path: Path
) -> None:
    manifest = _excluding(syn.manifest, ["drug", "chip_antigen", "drug"], syn.root / "excluding.yaml")
    assert _version_excluded(_full(manifest, tmp_path / "excluding.duckdb")) == ["chip_antigen", "drug"]
    assert _version_excluded(_full(syn.manifest, tmp_path / "everything.duckdb")) == []
    empty = _excluding(syn.manifest, [], syn.root / "empty.yaml")
    assert _version_excluded(_full(empty, tmp_path / "empty.duckdb")) == []


def _forget_excluded_fields(store: Path) -> None:
    """Make a store look like a store that was written before stores recorded their excluded fields."""
    con = duckdb.connect(str(store))
    try:
        con.execute("DELETE FROM store_meta WHERE key = 'excluded_fields'")
        con.execute("CHECKPOINT")
    finally:
        con.close()


def test_read_version_of_a_store_that_records_no_excluded_fields_returns_an_empty_list(
    syn: Synthetic, tmp_path: Path
) -> None:
    store = _full(syn.manifest, tmp_path / "old.duckdb")
    _forget_excluded_fields(store)
    assert _version_excluded(store) == []


def _prefix_store(syn: Synthetic, k: int, excluded: list[str] | None) -> Path:
    """A store of the first `k` runs. `None` writes a manifest without the `excluded_fields` item."""
    manifest = syn.manifest_with_runs(syn.run_names[:k], syn.root / f"prefix{k}.yaml")
    if excluded is not None:
        manifest = _excluding(manifest, excluded, syn.root / f"prefix{k}-excluding.yaml")
    return _full(manifest, syn.root / "store" / f"prefix{k}.duckdb")


def _operation(
    operation: str, syn: Synthetic, excluded: list[str] | None, store: Path, out: Path
) -> Callable[[], Verification]:
    """An append of the third run to a store of two runs, or a refresh of a store of three runs."""
    manifest = syn.manifest if excluded is None else _excluding(syn.manifest, excluded, syn.root / "operation.yaml")
    if operation == "append":
        return lambda: build_append(load_manifest(manifest), store, out, workers=1)
    return lambda: build_refresh(load_manifest(manifest), store, out)


@pytest.mark.parametrize("operation", ["append", "refresh"])
@pytest.mark.parametrize(
    ("stored", "requested"),
    [
        (None, ["chip_antigen"]),
        ([], ["chip_antigen"]),
        (["chip_antigen"], None),
        (["chip_antigen"], []),
        (["chip_antigen"], ["drug"]),
        (["chip_antigen"], ["chip_antigen", "drug"]),
        (["chip_antigen", "drug"], ["chip_antigen"]),
    ],
)
def test_append_and_refresh_with_other_excluded_fields_than_the_store_are_rejected_and_leave_no_file(
    syn: Synthetic, tmp_path: Path, operation: str, stored: list[str] | None, requested: list[str] | None
) -> None:
    store = _prefix_store(syn, 2 if operation == "append" else 3, stored)
    out = tmp_path / "out" / "new.duckdb"
    before = _sha256(store)
    with pytest.raises(BuildError, match="full build") as error:
        _operation(operation, syn, requested, store, out)()
    assert "excluded fields" in str(error.value)
    for name in {*(stored or []), *(requested or [])}:
        assert name in str(error.value)
    assert _names(out.parent) == []
    assert _sha256(store) == before


@pytest.mark.parametrize("operation", ["append", "refresh"])
@pytest.mark.parametrize(
    ("stored", "requested"),
    [
        (None, None),
        (None, []),
        ([], None),
        (["chip_antigen"], ["chip_antigen"]),
        (["drug", "chip_antigen"], ["chip_antigen", "drug", "chip_antigen"]),
        (list(FIELDS), list(FIELDS)),
    ],
)
def test_append_and_refresh_with_the_excluded_fields_of_the_store_equal_a_full_build(
    syn: Synthetic, tmp_path: Path, operation: str, stored: list[str] | None, requested: list[str] | None
) -> None:
    store = _prefix_store(syn, 2 if operation == "append" else 3, stored)
    out = tmp_path / "new.duckdb"
    assert _operation(operation, syn, requested, store, out)().ok
    manifest = syn.manifest if requested is None else _excluding(syn.manifest, requested, syn.root / "full.yaml")
    assert _snapshot(out) == _snapshot(_full(manifest, tmp_path / "full.duckdb"))
    assert _version_excluded(out) == sorted(set(stored or []))


@pytest.mark.parametrize("operation", ["append", "refresh"])
def test_append_and_refresh_from_a_store_that_records_no_excluded_fields_accept_only_a_manifest_without_them(
    syn: Synthetic, tmp_path: Path, operation: str
) -> None:
    store = tmp_path / "old.duckdb"
    shutil.copy(_prefix_store(syn, 2 if operation == "append" else 3, None), store)
    _forget_excluded_fields(store)
    rejected = tmp_path / "rejected" / "new.duckdb"
    with pytest.raises(BuildError, match="excluded fields"):
        _operation(operation, syn, ["chip_antigen"], store, rejected)()
    assert _names(rejected.parent) == []
    out = tmp_path / "new.duckdb"
    assert _operation(operation, syn, None, store, out)().ok
    assert _snapshot(out) == _snapshot(_full(syn.manifest, tmp_path / "full.duckdb"))


def test_append_with_an_excluded_field_does_not_read_the_field_from_the_new_runs(
    syn: Synthetic, tmp_path: Path
) -> None:
    store = _prefix_store(syn, 2, ["chip_antigen"])
    out = tmp_path / "appended.duckdb"
    assert _operation("append", syn, ["chip_antigen"], store, out)().ok
    assert set(_rows_of_field(out, "chip_antigen").values()) == {0}
    assert _field_names(out) == [f for f in FIELDS if f != "chip_antigen"]
