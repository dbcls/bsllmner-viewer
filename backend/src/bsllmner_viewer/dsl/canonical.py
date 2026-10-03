"""The canonical form of the decimal numbers that the DSL and the aggregation elements accept."""

from __future__ import annotations

import re
from typing import Final

ORGANISM_ID_MAX: Final = 2**31 - 1
YEAR_MIN: Final = 1000
YEAR_MAX: Final = 9999

_CANONICAL = re.compile(r"(?:0|[1-9][0-9]*)\Z")


def canonical_int(value: str, *, minimum: int = 0, maximum: int) -> int | None:
    """The integer of a canonical decimal string, or None.

    A canonical string is ASCII digits only, with no sign, no space, and no leading zero, and its value is between
    `minimum` and `maximum`. The length is checked before the conversion, so any input is cheap.
    """
    if len(value) > len(str(maximum)) or _CANONICAL.match(value) is None:
        return None
    number = int(value)
    return number if minimum <= number <= maximum else None
