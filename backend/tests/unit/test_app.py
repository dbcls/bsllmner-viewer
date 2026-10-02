from __future__ import annotations

import pytest

from bsllmner_viewer.api.app import create_app


def test_create_app_without_a_store_path_or_environment_variable_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BSLLMNER_VIEWER_STORE", raising=False)
    with pytest.raises(RuntimeError, match="BSLLMNER_VIEWER_STORE"):
        create_app()
