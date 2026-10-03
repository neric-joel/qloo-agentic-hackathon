"""Wording the agent reads and the API returns must not overclaim what taste overlap is.

Taste overlap is a rank derived from Qloo affinities: it is not a headcount, not a share of fans and
not a causal claim. Every string literal in the app package is checked, whole file at a time with
whitespace collapsed, so a phrase split across lines or implicit string concatenation is still caught.
"""

import ast
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"

FORBIDDEN = [
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
]


def string_literals(path: Path) -> str:
    """All string constants in a module (docstrings and f-string parts included), joined by spaces."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    parts = [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]
    return re.sub(r"\s+", " ", " ".join(parts))


def test_no_overclaiming_phrases_in_app_strings():
    hits = []
    for path in sorted(APP.rglob("*.py")):
        text = string_literals(path).casefold()
        for pattern in FORBIDDEN:
            for match in re.finditer(pattern, text):
                start = max(0, match.start() - 40)
                hits.append(f"{path.relative_to(APP.parent)}: ...{text[start : match.end() + 40]}...")
    assert not hits, "Overclaiming wording:\n" + "\n".join(hits)


def test_guard_catches_a_phrase_split_across_concatenated_literals(tmp_path):
    module = tmp_path / "sample.py"
    module.write_text(
        'MESSAGE = (\n    "how many of them are the same "\n    "people"\n)\n', encoding="utf-8"
    )
    assert "same people" in string_literals(module).casefold()
