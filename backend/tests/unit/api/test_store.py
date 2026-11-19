from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import duckdb
import pytest

from bsllmner_viewer.api.store import Store, disable_transparent_huge_pages
from bsllmner_viewer.store.schema import SCHEMA_VERSION


def test_store_opens_a_store_of_the_current_schema_version(store_path: Path) -> None:
    store = Store(store_path)
    try:
        assert store.fields
    finally:
        store.close()


@pytest.mark.parametrize("value", [str(SCHEMA_VERSION - 1), str(SCHEMA_VERSION + 1), None])
def test_store_refuses_another_schema_version_and_names_it(store_path: Path, tmp_path: Path, value: str | None) -> None:
    copy = tmp_path / "other.duckdb"
    shutil.copy(store_path, copy)
    con = duckdb.connect(str(copy))
    if value is None:
        con.execute("DELETE FROM store_meta WHERE key = 'schema_version'")
    else:
        con.execute("UPDATE store_meta SET value = ? WHERE key = 'schema_version'", [value])
    con.close()
    with pytest.raises(RuntimeError, match=f"store schema version {value}"):
        Store(copy)


# A process inherits the setting of the process that starts it, so the script turns the huge pages on first.
_HUGE_PAGES_OF_A_PROCESS = """
import ctypes
import sys
from pathlib import Path

from bsllmner_viewer.api.store import Store


def huge_pages() -> str:
    for line in Path("/proc/self/status").read_text().splitlines():
        if line.startswith("THP_enabled:"):
            return line.split()[1]
    return "unknown"


ctypes.CDLL(None).prctl(41, 0, 0, 0, 0)
before = huge_pages()
store = Store(Path(sys.argv[1]))
print(before, huge_pages())
store.close()
"""


@pytest.mark.skipif(sys.platform != "linux", reason="transparent huge pages are a setting of Linux")
def test_store_turns_off_transparent_huge_pages_for_the_process_that_opens_it(store_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, "-c", _HUGE_PAGES_OF_A_PROCESS, str(store_path)], capture_output=True, text=True, check=True
    )
    before, after = result.stdout.split()
    if before == "unknown":
        pytest.skip("the kernel does not report THP_enabled")
    assert (before, after) == ("1", "0")


def test_disable_transparent_huge_pages_asks_the_kernel_to_disable_them_and_returns_its_answer() -> None:
    calls: list[tuple[int, int]] = []

    def accept(option: int, value: int) -> int:
        calls.append((option, value))
        return 0

    assert disable_transparent_huge_pages(accept) is True
    assert calls == [(41, 1)]
    assert disable_transparent_huge_pages(lambda option, value: -1) is False


@pytest.mark.parametrize("error", [AttributeError("prctl"), OSError("no C library")])
def test_disable_transparent_huge_pages_without_prctl_returns_false_and_does_not_raise(error: Exception) -> None:
    def missing(option: int, value: int) -> int:
        raise error

    assert disable_transparent_huge_pages(missing) is False


def test_disable_transparent_huge_pages_on_a_system_other_than_linux_does_not_call_prctl(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected(option: int, value: int) -> int:
        raise AssertionError("prctl was called")

    monkeypatch.setattr(sys, "platform", "darwin")
    assert disable_transparent_huge_pages(unexpected) is False
