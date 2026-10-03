"""The error of a manifest or an input that violates the build's validation rules."""

from __future__ import annotations


class BuildError(Exception):
    """A manifest or input that violates the build's validation rules."""
