"""Plain-English descriptions of the moves between two arrangements of the same timetable."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

from .layout import Layout
from .metrics import EPSILON, Scorer, clash_label
from .models import Festival, format_minutes
from .reports import MoveReport, SlotRef


def slot_ref(festival: Festival, layout: Layout, i: int) -> SlotRef:
    stage = festival.stage_by_id()[layout.rules.stage_ids[layout.stage[i]]]
    start, end = layout.start[i], layout.end(i)
    label = f"{festival.days[layout.day[i]]} {format_minutes(start)}-{format_minutes(end)}, {stage.name}"
    return SlotRef(day=layout.day[i], stage_id=stage.id, start=start, end=end, label=label)


def describe_moves(festival: Festival, before: Layout, after: Layout, scorer: Scorer) -> list[MoveReport]:
    """One report per set whose slot differs between two layouts: its regret share and a reason.

    The regret deltas add up to the change in the timetable's regret.
    """
    rules = before.rules
    displaced = [i for i in range(rules.n_sets) if before.placement(i) != after.placement(i)]
    concurrency_before = _concurrency(before)
    concurrency_after = _concurrency(after)
    reports = []
    for i in displaced:
        changes = _pair_changes(scorer, i, concurrency_before, concurrency_after, displaced)
        partner = _swap_partner(before, after, i, displaced)
        reports.append(
            MoveReport(
                act_id=rules.act_ids[i],
                name=rules.names[i],
                from_slot=slot_ref(festival, before, i),
                to_slot=slot_ref(festival, after, i),
                regret_delta=round(changes.net_regret, 6),
                swap_with=None if partner is None else rules.act_ids[partner],
                reason=_reason(scorer, rules.names, i, changes, partner),
            )
        )
    return reports


def _concurrency(layout: Layout) -> dict[tuple[int, int], float]:
    dur = layout.rules.dur
    return {(i, k): shared / min(dur[i], dur[k]) for i, k, shared in layout.concurrent_pairs()}


@dataclass
class _PairChanges:
    """What a move did to one set's pairs, per other set and largest first."""

    relieved: list[tuple[int, float]]
    added: list[tuple[int, float]]
    splits_gained: list[tuple[int, float]]

    @property
    def net_regret(self) -> float:
        return sum(v for _, v in self.added) - sum(v for _, v in self.relieved)


def _pair_changes(
    scorer: Scorer,
    i: int,
    before: dict[tuple[int, int], float],
    after: dict[tuple[int, int], float],
    displaced: list[int],
) -> _PairChanges:
    """Regret removed and added, and split quality gained, by moving set ``i``.

    A pair where both sets moved is shared evenly between them so the per-move deltas add up.
    """
    relieved: dict[int, float] = defaultdict(float)
    added: dict[int, float] = defaultdict(float)
    splits: dict[int, float] = defaultdict(float)
    for pair in set(before) | set(after):
        if i not in pair:
            continue
        k = pair[0] if pair[1] == i else pair[1]
        share = 0.5 if k in displaced else 1.0
        moved = after.get(pair, 0.0) - before.get(pair, 0.0)
        regret = scorer.regret_w[i][k] * moved * share
        if regret < 0:
            relieved[k] -= regret
        elif regret > 0:
            added[k] += regret
        if scorer.split_w[i][k] * moved > 0:
            splits[k] += scorer.split_w[i][k] * moved * share
    return _PairChanges(_largest(relieved), _largest(added), _largest(splits))


def _largest(values: dict[int, float]) -> list[tuple[int, float]]:
    ranked = ((k, v) for k, v in values.items() if v > EPSILON)
    return sorted(ranked, key=lambda item: (-item[1], item[0]))


def _swap_partner(before: Layout, after: Layout, i: int, displaced: list[int]) -> int | None:
    """The displaced set that now sits where ``i`` was, if ``i`` sits where that set was."""
    for k in displaced:
        if k != i and _in_place_of(after, k, before, i) and _in_place_of(after, i, before, k):
            return k
    return None


def _in_place_of(new: Layout, a: int, old: Layout, b: int) -> bool:
    """Does set ``a`` after the move overlap the slot that set ``b`` had before it?"""
    if (new.day[a], new.stage[a]) != (old.day[b], old.stage[b]):
        return False
    return min(new.end(a), old.end(b)) > max(new.start[a], old.start[b])


def _reason(scorer: Scorer, names: Sequence[str], i: int, changes: _PairChanges, partner: int | None) -> str:
    parts = []
    if changes.relieved:
        k = changes.relieved[0][0]
        more = len(changes.relieved) - 1
        tail = f" and {more} smaller overlap{'s' if more > 1 else ''}" if more else ""
        parts.append(
            f"Clears the clash with {names[k]} ({_audience(scorer, i, k)}{_hidden(scorer, i, k)}){tail}"
        )
    if changes.splits_gained:
        k = changes.splits_gained[0][0]
        parts.append(
            f"puts it head to head with {names[k]} so two big crowds split ({_audience(scorer, i, k)})"
        )
    if changes.added:
        k, regret = changes.added[0]
        lighter = regret < sum(r for _, r in changes.relieved)
        verb = "lands against" if lighter else "adds an overlap with"
        parts.append(f"{verb} {names[k]} ({_audience(scorer, i, k)})")
    if not parts:
        parts.append("Frees time for the other re-slotted sets")
    sentence = "; ".join(parts) + "."
    return sentence + (f" Swaps places with {names[partner]}." if partner is not None else "")


def _audience(scorer: Scorer, i: int, k: int) -> str:
    return f"{round(100 * scorer.overlap[i][k])}% shared audience"


def _hidden(scorer: Scorer, i: int, k: int) -> str:
    return ", a hidden clash between different genres" if clash_label(scorer, i, k) == "hidden" else ""
