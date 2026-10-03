"""Does every figure in an answer come from a tool result? A check, not a filter: it only reports.

A numeral in the answer is grounded when it appears in some tool's content, either exactly or as a tool
number rounded to the decimals the answer uses (``0.8758`` grounds ``0.88``), or, for a clock time, when the
same time appears in a tool string. Single-digit integers are ignored (counts such as "two sets" written as
digits, ranks, "a 5-minute grid"), and so is the scale in "out of 100".
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal

# A clock time (15:30, 25:05) or a number with optional thousands separators and decimals. Digits glued to
# letters still count ("blink-182", "15th"), digits inside a longer number do not. A time may be followed by
# a colon in prose ("19:35-20:15: the index goes ..."), but not by ":<digit>" (that is a longer clock). A
# number right after a colon counts unless a digit comes before that colon: tool content is compact JSON
# ("minutes":45).
_NUMERAL = re.compile(
    r"(?<![\d.])(?<!\d:)"
    r"(?:(?P<time>\d{1,2}:[0-5]\d)(?!\d|:\d)|(?P<number>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?))"
    r"(?!\d)"
)
_SCALE = re.compile(r"(?:\bout of|/)\s*100\b", re.IGNORECASE)


def _numerals(text: str) -> list[tuple[str, str]]:
    """``(kind, as written)`` for every numeral in ``text``, in order; kind is "time" or "number"."""
    return [
        ("time", match["time"]) if match["time"] else ("number", match["number"])
        for match in _NUMERAL.finditer(text)
    ]


def _clock(value: str) -> tuple[int, int]:
    hours, minutes = value.split(":")
    return int(hours), int(minutes)


def _decimal(value: str) -> Decimal:
    return Decimal(value.replace(",", ""))


def _places(value: str) -> int:
    return len(value.split(".")[1]) if "." in value else 0


def _rounds_to(source: Decimal, target: Decimal, places: int) -> bool:
    step = Decimal(1).scaleb(-places)
    return any(source.quantize(step, rounding=mode) == target for mode in (ROUND_HALF_UP, ROUND_HALF_EVEN))


def ungrounded_numbers(text: str, tool_contents: Iterable[str]) -> list[str]:
    """The numerals in ``text`` that no tool content backs, as written, in order of first appearance."""
    times: set[tuple[int, int]] = set()
    numbers: set[Decimal] = set()
    for content in tool_contents:
        for kind, value in _numerals(content):
            if kind == "time":
                times.add(_clock(value))
            else:
                numbers.add(_decimal(value))

    missing: list[str] = []
    for kind, value in _numerals(_SCALE.sub(" ", text)):
        if value in missing:
            continue
        if kind == "time":
            if _clock(value) not in times:
                missing.append(value)
            continue
        target, places = _decimal(value), _places(value)
        if places == 0 and target < 10:
            continue
        if target in numbers or any(_rounds_to(number, target, places) for number in numbers):
            continue
        missing.append(value)
    return missing
