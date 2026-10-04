from __future__ import annotations

import logging
from pathlib import Path

import pytest

from bsllmner_viewer.api.app import create_app


def test_create_app_without_a_store_path_or_environment_variable_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BSLLMNER_VIEWER_STORE", raising=False)
    with pytest.raises(RuntimeError, match="BSLLMNER_VIEWER_STORE"):
        create_app()


@pytest.mark.parametrize(("level", "prefix"), [(logging.WARNING, "WARNING:"), (logging.ERROR, "ERROR:")])
def test_a_log_line_of_the_api_starts_with_its_level_like_the_lines_of_uvicorn(
    store_path: Path, level: int, prefix: str
) -> None:
    create_app(store_path)
    create_app(store_path)
    logger = logging.getLogger("bsllmner_viewer")
    record = logger.makeRecord("bsllmner_viewer.api.problems", level, __file__, 0, "Query stopped", (), None)
    lines = [handler.format(record) for handler in logger.handlers]
    assert len(lines) == 1
    assert lines[0].startswith(prefix)
    assert lines[0].endswith(" Query stopped")
