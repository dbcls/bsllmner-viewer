from __future__ import annotations

from collections import Counter

import duckdb
from hypothesis import given
from hypothesis import strategies as st

from bsllmner_viewer.store.organisms import ORGANISM_NAMES

# Names that differ only in letter case, names with characters outside ASCII, and names that are a prefix of another.
_NAMES = st.sampled_from(["Homo sapiens", "homo sapiens", "HOMO SAPIENS", "Human", "9606", "École", "école", "H"])
# The number of BioSamples for each (organism ID, name), so that equal counts are common.
_COUNTS = st.dictionaries(
    st.tuples(st.integers(min_value=1, max_value=3), _NAMES), st.integers(min_value=1, max_value=3), max_size=12
)


def _oracle(rows: list[tuple[int, str]]) -> dict[int, str]:
    counts: dict[int, Counter[str]] = {}
    for organism_id, name in rows:
        counts.setdefault(organism_id, Counter())[name] += 1
    return {organism_id: min(names, key=lambda name: (-names[name], name)) for organism_id, names in counts.items()}


@given(_COUNTS, st.lists(st.integers(min_value=1, max_value=3), max_size=3))
def test_organism_name_of_an_id_is_the_most_common_name_and_the_first_in_character_order_among_equals(
    counts: dict[tuple[int, str], int], without_name: list[int]
) -> None:
    con = duckdb.connect()
    con.execute("CREATE TABLE biosample (organism_id BIGINT, organism_name VARCHAR)")
    rows = [key for key, n in counts.items() for _ in range(n)]
    for organism_id, name in rows:
        con.execute("INSERT INTO biosample VALUES (?, ?)", [organism_id, name])
    for organism_id in without_name:
        con.execute("INSERT INTO biosample VALUES (?, NULL)", [organism_id])
    con.execute("INSERT INTO biosample VALUES (NULL, 'Homo sapiens')")
    assert dict(con.execute(ORGANISM_NAMES).fetchall()) == _oracle(rows)


def test_organism_name_of_an_id_with_equal_counts_is_the_first_in_character_order() -> None:
    con = duckdb.connect()
    con.execute("CREATE TABLE biosample (organism_id BIGINT, organism_name VARCHAR)")
    con.executemany("INSERT INTO biosample VALUES (1, ?)", [("homo sapiens",), ("Homo sapiens",), ("école",)])
    assert con.execute(ORGANISM_NAMES).fetchall() == [(1, "Homo sapiens")]
