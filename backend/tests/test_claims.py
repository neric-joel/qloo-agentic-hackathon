"""Wording the agent reads and the API returns must not overclaim what taste overlap is.

Taste overlap is a rank derived from Qloo affinities: it is not a headcount, not a share of fans and
not a causal claim. Every string literal in the app package is checked, whole file at a time with
whitespace collapsed, so a phrase split across lines or implicit string concatenation is still caught.
Every tool's output is checked too, on a synthetic festival and on the real presets when they are present.
"""

import ast
import json
import re
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from app.agent.clash_tools import CLASH_TOOLS
from app.agent.tools import ToolContext, ToolInputError
from app.claims import FORBIDDEN_PATTERNS, RUNTIME_ONLY, find_claims
from app.config import Settings
from app.presets import get_presets
from app.qloo.client import QlooClient
from app.runs import CLASH_SYSTEM
from app.schedule.metrics import score_festival
from app.schedule.models import Festival, OverlapMatrix, ScoringConfig, format_minutes
from app.schedule.optimizer import _no_gain_message, _note
from app.schedule.reports import Movability
from app.schedule.synthetic import synthetic_festival
from tests.schedule_support import with_random_constraints

APP = Path(__file__).resolve().parent.parent / "app"
PRESETS = APP.parent / "presets"
# app/claims.py holds the patterns themselves, which would match their own source: it is the one file skipped.
PATTERN_SOURCE = APP / "claims.py"
# The agent's instructions quote two forbidden phrases in order to forbid them. That sentence is the only
# text exempt from the source scan, and the scan checks it is still there word for word.
FORBIDDING_SENTENCE = 'Do not call them "Qloo\'s own measure" or "Qloo\'s score".'
TOOLS = {tool.name: tool for tool in CLASH_TOOLS}


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
    assert FORBIDDING_SENTENCE in re.sub(r"\s+", " ", CLASH_SYSTEM)
    hits = []
    for path in sorted(APP.rglob("*.py")):
        if path == PATTERN_SOURCE:
            continue
        text = string_literals(path).replace(FORBIDDING_SENTENCE, "")
        hits += [
            f"{path.relative_to(APP.parent)}: ...{hit}..." for hit in find_claims(text, FORBIDDEN_PATTERNS)
        ]
    assert not hits, "Overclaiming wording:\n" + "\n".join(hits)


def test_guard_catches_a_phrase_split_across_concatenated_literals(tmp_path):
    module = tmp_path / "sample.py"
    module.write_text(
        'MESSAGE = (\n    "how many of them are the same "\n    "people"\n)\n', encoding="utf-8"
    )
    assert "same people" in string_literals(module).casefold()


@pytest.mark.parametrize(
    "text",
    [
        "By Qloo's own measure the two overlap.",
        "That is Qloo’s score for the pair.",
        "Qloo&#39;s measure puts them close.",
        "Moving it would impro​ve on the published day.",
        "A regret cut of 12%.",
        "About 40 % of the audience would go.",
        "40% of all fans",
        "Both draw big crowds.",
        "The crowd is split.",
        "an estimated headcount of 5,000",
    ],
)
def test_runtime_check_catches_overclaims_and_their_disguises(text):
    assert find_claims(text)


def test_runtime_check_passes_honest_wording():
    honest = (
        "Taste overlap is 92 out of 100, a rank among this day's acts calculated by this app from Qloo data. "
        "It is not a headcount. Moving Gurriers to 15:30 takes the Clash Budget Index from 116.7 to 114.3."
    )
    assert find_claims(honest) == []
    assert find_claims("Not a headcount, not crowds.", FORBIDDEN_PATTERNS) == []
    assert find_claims("crowds", RUNTIME_ONLY)


def test_optimizer_messages_say_what_changes_not_that_it_improves():
    movability = Movability(
        total_sets=12, locked=2, frozen_by_existing_violations=0, unscored=1, movable=9, movable_share=0.75
    )
    for message in (_no_gain_message(movability), _note("balanced", None, SimpleNamespace(weight=0.4), 3.2)):
        assert message and not re.search(r"improves? (this day|the timetable)|crowd", message, re.I)
        assert find_claims(message) == []


# ------------------------------------------------------------------------------------- tool output


def qloo() -> QlooClient:
    tags = [
        {"name": "Indie Rock", "tag_id": "g1", "subtype": "urn:tag:genre:music", "query": {"score": 0.91}},
        {"name": "Melancholy", "tag_id": "t1", "subtype": "urn:tag:theme:music", "query": {"score": 0.42}},
    ]
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"results": {"tags": tags}}))
    return QlooClient("k", backoff=0, max_rps=None, transport=transport)


async def tool_outputs(festival: Festival, matrix: OverlapMatrix, config: ScoringConfig) -> list[str]:
    """The content and summary of every clash tool, called the way a run would call them."""
    state = {"festival": festival, "matrix": matrix, "config": config}
    ctx = ToolContext(qloo=qloo(), state=state)
    texts: list[str] = []

    async def call(name: str, **args) -> None:
        try:
            out = await TOOLS[name].handler(args, ctx)
        except ToolInputError as exc:  # goes back to the model as text too
            texts.append(str(exc))
            return
        texts.extend([out.content, out.summary])

    report = score_festival(festival, matrix, config)
    await call("list_timetable")
    await call("clash_report", limit=20)
    for clash in report.clashes[:6]:
        await call("explain_clash", act_a=clash.a.act_id, act_b=clash.b.act_id)
    unscored = [u.act_id for u in report.coverage.unscored]
    if unscored:
        partner = next(a.id for a in festival.acts if a.id != unscored[0])
        await call("explain_clash", act_a=unscored[0], act_b=partner)
    slots = festival.timetable
    for slot in slots[:6]:
        await call("find_moves", act=slot.act_id, limit=3)
        stage = next(s.id for s in festival.stages if s.id != slot.stage_id)
        await call("try_move", act=slot.act_id, stage=stage, start=format_minutes(slot.start))
        await call("try_move", act=slot.act_id, stage=slot.stage_id, start=format_minutes(slot.start + 30))
    first, second = slots[0].act_id, slots[1].act_id
    for kind, time, other in (
        ("lock", "", ""),
        ("keep_stage", "", ""),
        ("not_before", format_minutes(slots[0].start), ""),
        ("not_after", format_minutes(slots[0].start), ""),
        ("keep_apart", "", second),
    ):
        await call("add_constraint", kind=kind, act=first, time=time, other_act=other)
    for objective in (1, 0.4):
        await call("reslot", objective=objective, move_budget=4)
    await ctx.qloo.aclose()
    return texts


def unit_slips(value: object, key: str = "") -> list[str]:
    """Keys in a tool's content that hand the model taste overlap or draw in the engine's 0-1 units."""
    if isinstance(value, dict):
        return [slip for k, item in value.items() for slip in unit_slips(item, k)]
    if isinstance(value, list):
        return [slip for item in value for slip in unit_slips(item, key)]
    if key in ("taste_overlap", "draw") or (
        ("overlap" in key or "draw" in key) and isinstance(value, float) and 0 < value < 1
    ):
        return [key]
    return []


def assert_clean(texts: list[str]) -> None:
    hits = [hit for text in texts for hit in find_claims(text)]
    assert not hits, "Overclaiming tool output:\n" + "\n".join(hits)
    slips = [slip for text in texts if text.startswith("{") for slip in unit_slips(json.loads(text))]
    assert not slips, f"Content in 0-1 units: {sorted(set(slips))}"


async def test_tool_output_on_a_synthetic_festival_makes_no_overclaim():
    base, matrix = synthetic_festival(5, days=1, acts=12)
    festival = with_random_constraints(
        base, 5, lock_share=0.2, stage_lock_share=0.3, allow_day_moves=False, window_share=0.5
    )
    config = ScoringConfig(baseline=score_festival(festival, matrix).baseline)
    assert_clean(await tool_outputs(festival, matrix, config))


@pytest.mark.skipif(not PRESETS.is_dir(), reason="the real presets are not in this checkout")
@pytest.mark.parametrize("preset_id", ["glastonbury-2025-sun", "riot-fest-2026-sun"])
async def test_tool_output_on_the_real_presets_makes_no_overclaim(preset_id):
    preset = get_presets(Settings(presets_dir=PRESETS, _env_file=None)).get(preset_id)
    if preset is None:
        pytest.skip(f"{preset_id} is not built in this checkout")
    config = ScoringConfig.model_validate({"baseline": preset.report["baseline"]})
    assert_clean(await tool_outputs(preset.festival, preset.matrix, config))
