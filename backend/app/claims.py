"""Phrases that overclaim what Clash Control's numbers are, for the source guard and for runtime checks.

Taste overlap is a rank derived from Qloo affinities: it is not a headcount, not a share of fans and not a
causal claim, and nothing the app calculates is Qloo's own measure. ``FORBIDDEN_PATTERNS`` must appear in no
string the app ships (``tests/test_claims.py`` scans them) and in no answer or tool output. ``RUNTIME_ONLY``
patterns are checked on what a run says, not on source, where comments may describe the engine's internals.
"""

from __future__ import annotations

import html
import re
from collections.abc import Sequence

FORBIDDEN_PATTERNS: list[str] = [
    r"same people",
    r"same crowds?",
    r"same fans",
    r"different people",
    r"fans at stake",
    r"fans of both",
    r"shared audience",
    r"big crowds",
    r"fan regret",
    r"% of (?:the )?fans",
    r"\d+% shared",
    r"optimal",
    r"outperform",
    r"no fan is torn",
    r"improves? on\b",
    r"regret cut",
    r"\d+\s*%\s*of (?:the |all )?(?:fans|audience)",
    r"qloo's (?:own )?(?:measure|score)",
]

RUNTIME_ONLY: list[str] = [
    r"\bcrowds?\b",
    r"(?<!not a )\bheadcount\b",
]

CONTEXT = 40  # characters of context kept on each side of a match

# Characters that can hide a phrase from a plain substring match
_INVISIBLE = re.compile("[​-‍⁠﻿­]")
_QUOTES = str.maketrans({"‘": "'", "’": "'", "ʼ": "'"})


def normalize(text: str) -> str:
    """Casefold, decode entities, straighten apostrophes, drop invisible characters, collapse whitespace."""
    text = _INVISIBLE.sub("", html.unescape(text)).translate(_QUOTES)
    return re.sub(r"\s+", " ", text).casefold()


def find_claims(text: str, patterns: Sequence[str] = (*FORBIDDEN_PATTERNS, *RUNTIME_ONLY)) -> list[str]:
    """Every overclaiming phrase in ``text``, each with up to 40 characters of context on either side."""
    text = normalize(text)
    return [
        text[max(0, match.start() - CONTEXT) : match.end() + CONTEXT]
        for pattern in patterns
        for match in re.finditer(pattern, text)
    ]
