"""Record real clash-agent runs on the preset festival days, for "Watch a recorded run".

    uv run python scripts/record_runs.py --all --dry-run
    uv run python scripts/record_runs.py --all
    uv run python scripts/record_runs.py --only hidden-clash-and-move

A real run is built as ``POST /api/runs`` builds it, with the run caps from the app's settings and the model
and Qloo keys from ``backend/.env`` (read by the app's own settings loader), so it spends money and Qloo
quota: about $0.05 a run, and at most 4 Qloo requests a run, 10 requests and $0.30 in all by default. Qloo is
called live (an empty response cache, nothing saved), so the recording keeps real request ids. A run is saved
only if it passes ``gate_failures``: complete, no overclaiming wording, no taste overlap or draw written as a
decimal, every number in the answer backed by something the model read, and the plan entry's own check. Each
saved run is merged by id into ``<out>/<preset_id>.json`` with its events untouched; copy the folder to
``backend/presets/recordings`` to ship it. The output holds Qloo-derived data: keep it out of version control
(``_private/`` and ``backend/presets/`` are git-ignored).

``--dry-run`` builds every run request against the presets and prints the plan. It reads no ``.env``, builds
no model backend and no Qloo client, and writes nothing.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Literal

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from anthropic.types import Message  # noqa: E402
from pydantic import ValidationError  # noqa: E402

from app.agent.events import encode  # noqa: E402
from app.agent.grounding import ungrounded_numbers  # noqa: E402
from app.agent.llm import DEFAULT_MODELS, LLMBackend, OnText, build_backend  # noqa: E402
from app.claims import FORBIDDEN_PATTERNS, RUNTIME_ONLY, find_claims  # noqa: E402
from app.config import Settings, get_settings  # noqa: E402
from app.presets import Preset, get_presets  # noqa: E402
from app.qloo.client import QlooClient  # noqa: E402
from app.recordings import MAX_RUNS, Recording  # noqa: E402
from app.runs import ClashInput, RunRequest, clash_state, execute_run  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "_private" / "presets" / "recordings"
NOT_CONFIGURED = "The LLM is not configured: set LLM_PROVIDER and a key in backend/.env"
MAX_QLOO_PER_RUN = 4
MAX_ELAPSED_MS = 40_000
# List price per million tokens of the production model (Sonnet 5.5). Cached input is counted at the full
# input price, so this estimate errs high; it is not a bill.
PRICE_IN, PRICE_OUT = 2.0, 10.0
# On top of the app's claim patterns: wording the recordings' acceptance check reads for
RECORDING_PATTERNS = [r"\bimprov(?:e|es|ed|ement|ements|ing)\b", r"qloo's own\b"]
CLAIM_PATTERNS = (*FORBIDDEN_PATTERNS, *RUNTIME_ONLY, *RECORDING_PATTERNS)
_DECIMAL_BELOW_ONE = re.compile(r"(?<![\d.])0\.\d")
_TWELVE_HOUR = re.compile(r"\b(\d{1,2}):([0-5]\d)\s*([ap])\.?m\b\.?", re.IGNORECASE)

Expects = Literal["live_qloo", "rules", "refusal", "abstain", "clean"]


@dataclass(frozen=True)
class PlanEntry:
    id: str
    preset_id: str
    title: str
    question: str
    expects: Expects  # the gate this run must pass on top of the common ones
    acts: tuple[str, ...]  # the acts the question names; the plan check makes sure they play that day


# Facts below were checked offline on the built presets (engine and tool handlers only, no model, no Qloo).
PLAN = [
    # Nadine Shah (Other 12:30-13:15) and Gurriers (Woodsies 12:30-13:30) overlap 45 minutes. Both have a Qloo
    # id and signal: explain_clash makes one live compare request. find_moves for Gurriers: 6 legal places,
    # best Woodsies 12:45 (116.7 to 114.8).
    PlanEntry(
        "hidden-clash-and-move",
        "glastonbury-2025-sun",
        "Explain a hidden clash and find a move",
        "Why do Nadine Shah and Gurriers clash, and where could Gurriers go instead? "
        "Test the best place against the rules before you recommend it.",
        "live_qloo",
        ("Nadine Shah", "Gurriers"),
    ),
    # Jorja Smith and Olivia Rodrigo are already locked; add_constraint accepts a lock on each and records
    # it. Parcels (West Holts 20:00-21:00) does not overlap The Maccabees (The Park 21:15-22:30), so the
    # keep-apart leaves it movable (Wolf Alice overlaps it 45 minutes and would leave it "tied up"). With the
    # three rules find_moves for Parcels gives 6 legal places, best West Holts 20:15 (116.7 to 113.2);
    # without the keep-apart it gives 9, best 20:30, so the rule visibly binds.
    PlanEntry(
        "rules-then-move",
        "glastonbury-2025-sun",
        "Set two rules, then move one set",
        "Keep Jorja Smith and Olivia Rodrigo where they are, and keep Parcels and The Maccabees from "
        "overlapping. Then tell me where Parcels could go.",
        "rules",
        ("Jorja Smith", "Olivia Rodrigo", "Parcels", "The Maccabees"),
    ),
    # try_move refuses it as a taken slot (allowed false): Joy Crookes plays Other 15:00-15:45. No Qloo call.
    PlanEntry(
        "engine-says-no",
        "glastonbury-2025-sun",
        "Ask for a move the rules refuse",
        "Can Nadine Shah play the Other stage at 15:30? Check it against the rules.",
        "refusal",
        ("Nadine Shah",),
    ),
    # Thandii (West Holts 11:00-12:00, coverage "none", no Qloo id) and The Selecter (Pyramid 11:15-12:00)
    # overlap 45 minutes; explain_clash returns taste overlap null before any Qloo request.
    PlanEntry(
        "no-qloo-signal",
        "glastonbury-2025-sun",
        "Ask about an act Qloo knows nothing about",
        "Why do Thandii and The Selecter clash?",
        "abstain",
        ("Thandii", "The Selecter"),
    ),
    # Taking Back Sunday (Riot 18:15-19:15) and Good Riddance (Radical 18:15-18:55) overlap 40 minutes, both
    # with a Qloo id and signal (one live compare request). Good Riddance is not locked; find_moves gives 9
    # legal places, best Rise 19:35 (86.5 to 83.5).
    PlanEntry(
        "riot-fest-move",
        "riot-fest-2026-sun",
        "Find a move on a second festival day",
        "Why do Taking Back Sunday and Good Riddance clash, and where could Good Riddance go instead?",
        "clean",
        ("Taking Back Sunday", "Good Riddance"),
    ),
]


class PlanError(ValueError):
    """The plan cannot run as written: a missing preset or act, a bad request, an output it would break."""


# ------------------------------------------------------------------------------------------ the plan


def select(only: str | None) -> list[PlanEntry]:
    if only is None:
        return list(PLAN)
    entries = [e for e in PLAN if e.id == only]
    if not entries:
        raise SystemExit(f"unknown run {only!r}; known: {', '.join(e.id for e in PLAN)}")
    return entries


def build_requests(
    entries: Iterable[PlanEntry], presets: Mapping[str, Preset]
) -> list[tuple[PlanEntry, RunRequest]]:
    """Each entry's run request, checked as ``create_run`` checks it before a run starts."""
    planned: list[tuple[PlanEntry, RunRequest]] = []
    problems: list[str] = []
    for entry in entries:
        preset = presets.get(entry.preset_id)
        if preset is None:
            problems.append(f"{entry.id}: no preset {entry.preset_id!r}")
            continue
        names = {act.name for act in preset.festival.acts}
        missing = [name for name in entry.acts if name not in names]
        if missing:
            problems.append(f"{entry.id}: {', '.join(missing)} not on {entry.preset_id}")
            continue
        try:
            data = ClashInput(preset_id=entry.preset_id, message=entry.question)
            request = RunRequest(scenario="clash", input=data)
            clash_state(preset, data)
        except ValueError as exc:  # a ValidationError or a SessionError
            problems.append(f"{entry.id}: {exc}")
            continue
        planned.append((entry, request))
    if problems:
        raise PlanError("; ".join(problems))
    return planned


def run_caps(settings: Settings, qloo_left: int) -> dict[str, Any]:
    """The caps ``create_run`` passes to ``execute_run``, from the settings; Qloo held to this script's."""
    return {
        "max_turns": settings.agent_max_turns,
        "max_tool_calls": settings.agent_max_tool_calls_per_turn,
        "max_qloo_calls": max(0, min(settings.agent_max_qloo_calls_per_run, MAX_QLOO_PER_RUN, qloo_left)),
        "max_reslots": settings.agent_max_reslots_per_run,
        "max_engine_seconds": settings.agent_max_engine_seconds,
    }


# ----------------------------------------------------------------------------------------- the gates


def answer_text(events: Sequence[Mapping[str, Any]]) -> str:
    result = next((e for e in events if e.get("type") == "result"), None)
    return str(((result or {}).get("data") or {}).get("text") or "")


def streamed_text(events: Sequence[Mapping[str, Any]]) -> str:
    """Everything the model wrote during the run, across turns (what the replay shows)."""
    return "".join(str(e.get("text", "")) for e in events if e.get("type") == "text_delta")


def _as_24_hour(text: str) -> str:
    """'8:15pm' as '20:15', so a time the tools gave in 24-hour form still grounds it."""

    def convert(match: re.Match[str]) -> str:
        hours = int(match[1]) % 12 + (12 if match[3].lower() == "p" else 0)
        return f"{hours:02d}:{match[2]}"

    return _TWELVE_HOUR.sub(convert, text)


def _contents_of(
    tool: str, events: Sequence[Mapping[str, Any]], contents: Mapping[str, str]
) -> list[dict[str, Any]]:
    """The JSON content the model read from each call of ``tool`` (error text is skipped)."""
    parsed = []
    for event in events:
        if event.get("type") != "tool_call" or event.get("tool") != tool:
            continue
        try:
            content = json.loads(contents.get(str(event.get("id")), ""))
        except json.JSONDecodeError:
            continue
        if isinstance(content, dict):
            parsed.append(content)
    return parsed


def _expectation_failures(
    events: Sequence[Mapping[str, Any]], expects: Expects, contents: Mapping[str, str]
) -> list[str]:
    if expects == "live_qloo":
        live = [
            request
            for event in events
            if event.get("type") == "tool_result"
            for request in event.get("requests") or []
            if request.get("cached") is False and not request.get("recorded") and request.get("request_id")
        ]
        return [] if live else ["expected a live Qloo request with a request id"]
    if expects == "abstain":
        unpriced = [
            c
            for c in _contents_of("explain_clash", events, contents)
            if "taste_overlap_out_of_100" in c and c["taste_overlap_out_of_100"] is None
        ]
        return [] if unpriced else ["expected explain_clash to report no Qloo signal (taste overlap null)"]
    if expects == "refusal":
        refused = [c for c in _contents_of("try_move", events, contents) if c.get("allowed") is False]
        return [] if refused else ["expected a try_move the rules refuse (allowed false)"]
    if expects == "rules":
        results = [e for e in events if e.get("type") == "result"]
        session = ((results[0].get("data") or {}).get("session") or {}) if len(results) == 1 else {}
        rules = session.get("rules") or []
        failures = [] if len(rules) >= 2 else [f"expected at least 2 recorded rules, got {len(rules)}"]
        if not (session.get("constraints") or {}).get("no_clash_with"):
            failures.append("expected a keep-apart rule in the session")
        return failures
    return []


def gate_failures(
    events: Sequence[Mapping[str, Any]],
    entry: PlanEntry,
    tool_contents: Mapping[str, str] | None = None,
    prompt: str = "",
) -> list[str]:
    """Why a run may not be saved; an empty list means it passes.

    ``events`` are the bare events in order. ``tool_contents`` maps each tool_use id to the content the model
    read (the events carry only summaries); ``prompt`` is the user message the run sent. A number in the
    question or the prompt counts as grounded.
    """
    contents = tool_contents or {}
    failures: list[str] = []
    types = [e.get("type") for e in events]
    if not types or types[0] != "run_started" or types[-1] != "run_finished":
        failures.append("incomplete: a run starts with run_started and ends with run_finished")
    failures += [f"error event: {e.get('message')}" for e in events if e.get("type") == "error"]
    results = [e for e in events if e.get("type") == "result"]
    if len(results) != 1 or results[0].get("kind") != "clash":
        failures.append("needs exactly one result, of kind clash")
    elapsed = (events[-1].get("elapsed_ms") if types[-1:] == ["run_finished"] else None) or 0
    if elapsed > MAX_ELAPSED_MS:
        failures.append(f"took {elapsed} ms (at most {MAX_ELAPSED_MS})")

    answer, said = answer_text(events), streamed_text(events)
    summaries = [str(e.get("summary", "")) for e in events if e.get("type") == "tool_result"]
    hits = (hit for text in (said, answer, *summaries) for hit in find_claims(text, CLAIM_PATTERNS))
    claims = list(dict.fromkeys(hits))
    if claims:
        failures.append(f"overclaiming wording: {claims}")
    if _DECIMAL_BELOW_ONE.search(said) or _DECIMAL_BELOW_ONE.search(answer):
        failures.append("writes a decimal below 1 (taste overlap and draw are whole numbers out of 100)")
    missing = ungrounded_numbers(_as_24_hour(answer), [*contents.values(), entry.question, prompt])
    if missing:
        failures.append(f"numbers in the answer that nothing the model read backs: {missing}")
    return failures + _expectation_failures(events, entry.expects, contents)


def estimate_cost(usage: Mapping[str, int] | None) -> float:
    """Dollars at the list price; ``usage`` is run_finished's ``{"input_tokens", "output_tokens"}``."""
    usage = usage or {}
    return (usage.get("input_tokens", 0) * PRICE_IN + usage.get("output_tokens", 0) * PRICE_OUT) / 1_000_000


def can_afford(costs: Sequence[float], max_cost: float) -> bool:
    """Whether another run fits the spend limit, taking the dearest run so far as the next one's cost."""
    return sum(costs) + max(costs, default=0.0) <= max_cost


# ----------------------------------------------------------------------------------------- the files


def to_recording(
    entry: PlanEntry, events: Iterable[Mapping[str, Any]], model: str, captured_at: datetime
) -> dict[str, Any]:
    return {
        "id": entry.id,
        "title": entry.title,
        "question": entry.question,
        "captured_at": captured_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": model,
        "events": list(events),
    }


def merge_runs(
    existing: Mapping[str, Any] | None, preset_id: str, runs: Iterable[Mapping[str, Any]]
) -> dict[str, Any]:
    """The file body with ``runs`` merged in by id: a known id is replaced in place, a new one appended."""
    merged = [dict(r) for r in ((existing or {}).get("runs") or [])]
    for run in runs:
        at = next((i for i, r in enumerate(merged) if r.get("id") == run["id"]), None)
        if at is None:
            merged.append(dict(run))
        else:
            merged[at] = dict(run)
    return {"preset_id": preset_id, "runs": merged}


def read_recordings(path: Path, preset_id: str) -> dict[str, Any] | None:
    """The recordings file at ``path``, or None when there is none; refuses one a merge would clobber."""
    if not path.exists():
        return None
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PlanError(f"{path} cannot be read ({exc}); move it aside first") from exc
    if (
        not isinstance(body, dict)
        or body.get("preset_id") != preset_id
        or not isinstance(body.get("runs"), list)
    ):
        raise PlanError(f"{path} is not a recordings file for {preset_id}; move it aside first")
    return body


def check_out(out: Path, entries: Sequence[PlanEntry]) -> list[str]:
    """One line per file the plan writes to; refuses a file the merge would leave with too many runs."""
    lines = []
    for preset_id in dict.fromkeys(e.preset_id for e in entries):
        existing = read_recordings(out / f"{preset_id}.json", preset_id)
        have = [r.get("id") for r in (existing or {}).get("runs", []) if isinstance(r, dict)]
        after = len(dict.fromkeys([*have, *(e.id for e in entries if e.preset_id == preset_id)]))
        if after > MAX_RUNS:
            raise PlanError(f"{preset_id}.json would hold {after} runs (at most {MAX_RUNS} are served)")
        lines.append(f"{preset_id}.json: {len(have)} runs now, {after} after")
    return lines


def save_run(out: Path, preset_id: str, run: Mapping[str, Any]) -> Path:
    """Merge one run into its preset's file, replacing the file in one step."""
    path = out / f"{preset_id}.json"
    body = merge_runs(read_recordings(path, preset_id), preset_id, [run])
    out.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_text(json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8")
    partial.replace(path)
    return path


# ------------------------------------------------------------------------------------------ recording


class Collector:
    """An event channel that keeps each event as the stream sends it, with its time since the run started."""

    def __init__(self) -> None:
        self.started = time.perf_counter()
        self.events: list[dict[str, Any]] = []

    async def emit(self, event: dict[str, Any]) -> None:
        t = round((time.perf_counter() - self.started) * 1000)
        # Through the SSE encoder, so the copy is exactly what a browser would have parsed
        self.events.append({"t": t, "event": json.loads(encode(event).removeprefix("data: "))})

    async def close(self) -> None:
        return None


class ContentCapture:
    """Wraps the model backend to keep what the model reads: its prompt and each tool's content."""

    def __init__(self, backend: LLMBackend) -> None:
        self.backend = backend
        self.name = backend.name
        self.prompt = ""
        self.contents: dict[str, str] = {}

    async def turn(
        self,
        *,
        system: Sequence[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: Sequence[dict[str, Any]],
        on_text: OnText,
    ) -> Message:
        if messages and isinstance(messages[0].get("content"), str):
            self.prompt = messages[0]["content"]
        last = messages[-1]["content"] if messages else None
        if isinstance(last, list):
            for block in last:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    self.contents[block["tool_use_id"]] = str(block.get("content", ""))
        return await self.backend.turn(system=system, messages=messages, tools=tools, on_text=on_text)


async def record_one(
    entry: PlanEntry,
    request: RunRequest,
    backend: LLMBackend,
    qloo: QlooClient,
    presets: Mapping[str, Preset],
    caps: Mapping[str, Any],
) -> dict[str, Any]:
    """Run one plan entry; return its timed events, the gate verdict and what it used."""
    capture = ContentCapture(backend)
    channel = Collector()
    await execute_run(channel, capture, qloo, request, dict(presets), **caps)
    events = [timed["event"] for timed in channel.events]
    finished = events[-1] if events and events[-1].get("type") == "run_finished" else {}
    return {
        "timed": channel.events,
        "failures": gate_failures(events, entry, capture.contents, capture.prompt),
        "usage": finished.get("usage") or {},
        "qloo_calls": finished.get("qloo_calls") or 0,
        "elapsed_ms": finished.get("elapsed_ms"),
        "answer": answer_text(events),
    }


def dry_run(args: argparse.Namespace, entries: Sequence[PlanEntry]) -> int:
    # Only the presets are needed, so no .env is read and no key is even loaded
    presets = get_presets(Settings(_env_file=None))
    try:
        planned = build_requests(entries, presets)
        files = check_out(args.out, entries)
    except PlanError as exc:
        raise SystemExit(f"The plan cannot run: {exc}") from None
    print(f"Dry run: {len(planned)} runs. Nothing goes to the model or Qloo, and nothing is written.\n")
    for entry, request in planned:
        print(f"{entry.id}  [{request.scenario} on {entry.preset_id}, gate: {entry.expects}]")
        print(f"  {entry.title}")
        print(f"  {request.input.message}")
    print(f"\nWould write to {args.out}:")
    for line in files:
        print(f"  {line}")
    print(
        f"\nA real run tries each question up to {args.attempts} times, at most {MAX_QLOO_PER_RUN} Qloo "
        f"requests a run, and stops at {args.max_qloo} Qloo requests or about ${args.max_cost:.2f} in all."
    )
    return 0


async def record(args: argparse.Namespace, entries: Sequence[PlanEntry]) -> int:
    settings = get_settings()
    # The production model for the provider, whatever AGENT_MODEL says locally (or --model)
    model = args.model or DEFAULT_MODELS.get(settings.llm_provider)
    settings = settings.model_copy(update={"agent_model": model, "agent_effort": args.effort})
    backend = build_backend(settings, {})
    if backend is None:
        raise SystemExit(NOT_CONFIGURED)
    if not settings.qloo_api_key:
        raise SystemExit("Qloo is not configured: set QLOO_API_KEY in backend/.env")
    presets = get_presets(settings)
    try:
        planned = build_requests(entries, presets)
        check_out(args.out, entries)
    except PlanError as exc:
        raise SystemExit(f"The plan cannot run: {exc}") from None
    if args.force:
        print("WARNING: --force saves runs that fail the gates.")
    print(f"Model {backend.name}, effort {args.effort}.")
    print(f"Stops at {args.max_qloo} Qloo requests or about ${args.max_cost:.2f} in all.")

    qloo_used, costs, failed = 0, [], []
    for entry, request in planned:
        for attempt in range(1, args.attempts + 1):
            qloo_left = args.max_qloo - qloo_used
            if qloo_left < 1 or not can_afford(costs, args.max_cost):
                print(
                    f"Stopping before {entry.id}: the Qloo or spend limit is reached (about "
                    f"${sum(costs):.3f} and {qloo_used} Qloo requests so far)."
                )
                return 1
            with TemporaryDirectory() as empty:
                # No saved responses and none written: every Qloo request is live and keeps its request id
                qloo = QlooClient(
                    settings.qloo_api_key,
                    settings.qloo_base_url,
                    fixtures_dir=Path(empty),
                    record_fixtures=False,
                )
                try:
                    caps = run_caps(settings, qloo_left)
                    outcome = await record_one(entry, request, backend, qloo, presets, caps)
                finally:
                    await qloo.aclose()
            usage, cost = outcome["usage"], estimate_cost(outcome["usage"])
            costs.append(cost)
            qloo_used += outcome["qloo_calls"]
            print(
                f"\n{entry.id} (attempt {attempt}): {outcome['elapsed_ms']} ms, "
                f"{usage.get('input_tokens', 0)} in / {usage.get('output_tokens', 0)} out tokens, "
                f"about ${cost:.3f}, {outcome['qloo_calls']} Qloo requests"
            )
            print(f"Answer: {outcome['answer']}")
            run = to_recording(entry, outcome["timed"], backend.name, datetime.now(UTC))
            failures = outcome["failures"]
            try:
                Recording.model_validate(run)
            except ValidationError as exc:  # never saved, even with --force: the endpoint would not serve it
                reason = str(exc.errors()[0]["msg"]).removeprefix("Value error, ")
                print(f"Not saved: the recording would not be served ({reason})")
                continue
            if failures and not args.force:
                print("Gate failed: " + " | ".join(failures))
                continue
            print(f"Saved to {save_run(args.out, entry.preset_id, run)}")
            break
        else:
            failed.append(entry.id)

    print(
        f"\nTotal: about ${sum(costs):.3f}, {qloo_used} Qloo requests."
        + (f" Not saved: {failed}" if failed else "")
    )
    print("To ship them: cp -r _private/presets/recordings backend/presets/recordings")
    return 1 if failed else 0


# ------------------------------------------------------------------------------------------------ cli


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    which = ap.add_mutually_exclusive_group(required=True)
    which.add_argument("--all", action="store_true", help="every run in the plan")
    which.add_argument("--only", metavar="ID", help="one run, by id")
    ap.add_argument("--out", type=Path, default=OUT, help="folder for <preset_id>.json (default: _private)")
    ap.add_argument("--dry-run", action="store_true", help="check and print the plan only")
    ap.add_argument("--force", action="store_true", help="save runs that fail the gates")
    ap.add_argument("--attempts", type=int, default=3, help="tries per question before giving up (default 3)")
    ap.add_argument("--model", default=None, help="model id (default: the production model, Sonnet 5.5)")
    ap.add_argument("--effort", default="low", choices=["low", "medium", "high"])
    ap.add_argument("--max-qloo", type=int, default=10, help="most Qloo requests in all (default 10)")
    ap.add_argument("--max-cost", type=float, default=0.30, help="estimated dollars to stop at (0.30)")
    args = ap.parse_args(argv)
    if args.attempts < 1:
        ap.error("--attempts must be at least 1")
    return args


def run(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    entries = select(args.only)
    if args.dry_run:
        return dry_run(args, entries)
    return asyncio.run(record(args, entries))


def main() -> None:
    sys.stdout.reconfigure(errors="replace")  # an answer may hold characters the console cannot show
    raise SystemExit(run())


if __name__ == "__main__":
    main()
