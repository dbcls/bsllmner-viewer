"""Short names for the paths of the record of an entry, as the original metadata shows them."""

from __future__ import annotations

# Path: name. A path is named by the first entry that it equals or starts with, followed by a period.
_SHORT_NAMES: tuple[tuple[str, str], ...] = (
    ("Owner.Name", "Owner"),
    ("Links.Link", "Link"),
    ("Ids.Id", "ID"),
    ("Status", "Status"),
    ("Package", "Package"),
    ("Models.Model", "Model"),
    ("access", "Access"),
    ("accession", "Accession"),
    ("id", "ID"),
    ("publication_date", "Publication date"),
    ("last_update", "Last update"),
    ("submission_date", "Submission date"),
    ("Description.Organism", "Organism"),
)


def record_name(path: str) -> str:
    """The short name of a path of the record, or the path itself when no short name covers it."""
    for prefix, name in _SHORT_NAMES:
        if path == prefix or path.startswith(f"{prefix}."):
            return name
    return path
