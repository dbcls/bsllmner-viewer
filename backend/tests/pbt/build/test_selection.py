from __future__ import annotations

import datetime
from pathlib import Path

import duckdb
from hypothesis import given, settings
from hypothesis import strategies as st

from bsllmner_viewer.build.ingest import build_append, build_full
from bsllmner_viewer.build.manifest import load_manifest
from tests.synthetic import Synthetic, generate

type Stored = dict[str, tuple[str, datetime.date | None, str, list[tuple[object, ...]]]]


def _stored(path: Path) -> Stored:
    con = duckdb.connect(str(path), read_only=True)
    try:
        annotations: dict[str, list[tuple[object, ...]]] = {}
        for row in con.execute(
            "SELECT biosample, field, value_index, extracted_value, status, term_id FROM annotation "
            "ORDER BY biosample, field, value_index"
        ).fetchall():
            annotations.setdefault(str(row[0]), []).append(tuple(row[1:]))
        return {
            str(a): (str(r), d, str(attrs), annotations.get(str(a), []))
            for a, r, d, attrs in con.execute(
                "SELECT b.accession, r.name, b.date_published, b.attributes FROM biosample b JOIN run r USING (run_id)"
            ).fetchall()
        }
    finally:
        con.close()


def _first_runs(synthetic: Synthetic) -> dict[str, str]:
    order = {name: i for i, name in enumerate(synthetic.run_names)}
    first: dict[str, str] = {}
    for run, accession in synthetic.truth.modified:
        if accession not in first or order[run] < order[first[accession]]:
            first[accession] = run
    return first


@settings(max_examples=6)
@given(seed=st.integers(0, 10_000), n_runs=st.integers(2, 4), overlap=st.floats(0.2, 0.9))
def test_selection_keeps_the_first_manifest_run_whatever_the_dates_of_the_entries(
    seed: int, n_runs: int, overlap: float, tmp_path_factory: object
) -> None:
    root = tmp_path_factory.mktemp("selection")  # type: ignore[attr-defined]
    synthetic = generate(root, seed=seed, n_biosamples=40, n_runs=n_runs, overlap=overlap)
    result = build_full(load_manifest(synthetic.manifest), root / "store" / "full.duckdb", workers=1)
    assert result.ok, result.problems
    stored = _stored(root / "store" / "full.duckdb")
    first = _first_runs(synthetic)
    assert {a: run for a, (run, *_) in stored.items()} == first
    assert any(sum(1 for r, a in synthetic.truth.modified if a == accession) > 1 for accession in first), (
        "the generator must produce BioSamples in several runs"
    )
    for accession, (run, date, _, rows) in stored.items():
        assert date == synthetic.truth.published[(run, accession)]
        expected = [
            (field, i, value, status, term_id)
            for field in sorted(("cell_line", "disease", "tissue", "drug", "chip_antigen"))
            for i, (value, status, term_id) in enumerate(synthetic.truth.annotations[(run, accession, field)])
        ]
        assert [(f, i, v, s, t) for f, i, v, s, t in rows] == expected


@settings(max_examples=6)
@given(seed=st.integers(0, 10_000), n_runs=st.integers(2, 4), overlap=st.floats(0.2, 0.9), data=st.data())
def test_append_never_changes_a_biosample_already_in_the_store(
    seed: int, n_runs: int, overlap: float, data: st.DataObject, tmp_path_factory: object
) -> None:
    root = tmp_path_factory.mktemp("append")  # type: ignore[attr-defined]
    synthetic = generate(root, seed=seed, n_biosamples=40, n_runs=n_runs, overlap=overlap)
    k = data.draw(st.integers(1, n_runs - 1))
    prefix_manifest = synthetic.manifest_with_runs(synthetic.run_names[:k], root / "prefix.yaml")
    assert build_full(load_manifest(prefix_manifest), root / "prefix.duckdb", workers=1).ok
    before = _stored(root / "prefix.duckdb")
    assert build_append(
        load_manifest(synthetic.manifest), root / "prefix.duckdb", root / "appended.duckdb", workers=1
    ).ok
    after = _stored(root / "appended.duckdb")
    assert before
    assert {a: after[a] for a in before} == before
    assert set(after) >= set(before)
