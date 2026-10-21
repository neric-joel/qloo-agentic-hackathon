import { describe, expect, it } from "vitest";

import * as locks from "./locks";
import {
  LOCK_GENERIC,
  LOCK_INVENTED,
  LOCK_RULE,
  LOCK_RULE_GENERIC,
  LOCK_SHORT,
  lockLabel,
  lockRuleHolds,
  lockRuleLine,
  type LockSlot,
} from "./locks";

/** A slot on day 0; times in minutes from the day's midnight (13:00 is 780, 24:30 is 1470). */
function slot(stage: string, start: number, end: number, locked: boolean, day = 0): LockSlot {
  return { stage, day, start, end, locked };
}

/** Two stages, one day, three sets each; the locked sets are exactly the last on each stage. */
function twoStageDay(): LockSlot[] {
  return [
    slot("Pyramid", 780, 840, false),
    slot("Pyramid", 900, 975, false),
    slot("Pyramid", 1290, 1410, true),
    slot("Other", 810, 870, false),
    slot("Other", 960, 1020, false),
    slot("Other", 1260, 1350, true),
  ];
}

/** The same two stages over two days; on each day the last set on each stage is locked. */
function twoStageTwoDays(): LockSlot[] {
  return [
    ...twoStageDay(),
    slot("Pyramid", 720, 780, false, 1),
    slot("Pyramid", 1320, 1440, true, 1),
    slot("Other", 750, 810, false, 1),
    slot("Other", 1380, 1470, true, 1),
  ];
}

/** A copy of the list with the slot at `index` locked or unlocked. */
function withLocked(slots: LockSlot[], index: number, locked: boolean): LockSlot[] {
  return slots.map((s, i) => (i === index ? { ...s, locked } : s));
}

describe("lock wording", () => {
  it("keeps each sentence byte for byte", () => {
    expect(LOCK_RULE).toBe(
      "On the published days, the locked sets are the last set on each stage. This app keeps them in place; the festivals did not mark them.",
    );
    expect(LOCK_RULE_GENERIC).toBe(
      "On the published days, locked sets are ones this app keeps in place; the festivals did not mark them.",
    );
    expect(LOCK_SHORT).toBe("Locked by this app: the last set on its stage stays in place.");
    expect(LOCK_GENERIC).toBe("Locked by this app: kept in place.");
    expect(LOCK_INVENTED).toBe("Locked: an invented fixed slot.");
  });

  it("exports exactly the five sentences and three functions at run time", () => {
    expect(Object.keys(locks).sort()).toEqual(
      [
        "LOCK_GENERIC",
        "LOCK_INVENTED",
        "LOCK_RULE",
        "LOCK_RULE_GENERIC",
        "LOCK_SHORT",
        "lockLabel",
        "lockRuleHolds",
        "lockRuleLine",
      ].sort(),
    );
  });

  it("never says headliner, never says 'not by the festival', and holds no digit", () => {
    for (const sentence of [LOCK_RULE, LOCK_RULE_GENERIC, LOCK_SHORT, LOCK_GENERIC, LOCK_INVENTED]) {
      expect(sentence).not.toMatch(/headliner/i);
      expect(sentence).not.toMatch(/not by the festival/i);
      expect(sentence).not.toMatch(/\d/);
    }
  });
});

describe("lockRuleHolds", () => {
  it("is true when the locked sets are exactly the last set on each stage", () => {
    expect(lockRuleHolds(twoStageDay())).toBe(true);
  });

  it("is false when a locked set is not the last on its stage", () => {
    // Pyramid's middle set is locked and its last set is not; Other is still right.
    const slots = withLocked(withLocked(twoStageDay(), 1, true), 2, false);
    expect(lockRuleHolds(slots)).toBe(false);
  });

  it("is false when one stage's last set is unlocked while the other stage's last set is locked", () => {
    expect(lockRuleHolds(withLocked(twoStageDay(), 5, false))).toBe(false);
    expect(lockRuleHolds(withLocked(twoStageDay(), 2, false))).toBe(false);
  });

  it("is false when a stage's last set and an earlier set on it are both locked", () => {
    expect(lockRuleHolds(withLocked(twoStageDay(), 0, true))).toBe(false);
    expect(lockRuleHolds(withLocked(twoStageDay(), 4, true))).toBe(false);
  });

  it("is false when nothing is locked", () => {
    expect(lockRuleHolds(twoStageDay().map((s) => ({ ...s, locked: false })))).toBe(false);
  });

  it("is false on an empty list", () => {
    expect(lockRuleHolds([])).toBe(false);
  });

  it("judges each stage on each day, not each stage across the days", () => {
    expect(lockRuleHolds(twoStageTwoDays())).toBe(true);
    // Day 1's last set on Other (index 9) unlocked: that stage-day breaks the rule.
    expect(lockRuleHolds(withLocked(twoStageTwoDays(), 9, false))).toBe(false);
    // Day 0's last set on Pyramid unlocked, day 1 untouched: still false.
    expect(lockRuleHolds(withLocked(twoStageTwoDays(), 2, false))).toBe(false);
  });

  it("counts a set past midnight as later than one before it", () => {
    const slots = [slot("Park", 1380, 1440, false), slot("Park", 1470, 1530, true)];
    expect(lockRuleHolds(slots)).toBe(true);
    expect(lockRuleHolds(slots.map((s) => ({ ...s, locked: !s.locked })))).toBe(false);
  });

  it("breaks a tie on start by the later end", () => {
    const later = [slot("Park", 1200, 1260, false), slot("Park", 1200, 1290, true)];
    expect(lockRuleHolds(later)).toBe(true);
    const earlier = [slot("Park", 1200, 1260, true), slot("Park", 1200, 1290, false)];
    expect(lockRuleHolds(earlier)).toBe(false);
  });

  it("is false when two sets on a stage share the latest start and end, so no single set is the last", () => {
    expect(lockRuleHolds([slot("Park", 1200, 1290, true), slot("Park", 1200, 1290, false)])).toBe(false);
    expect(lockRuleHolds([slot("Park", 1200, 1290, true), slot("Park", 1200, 1290, true)])).toBe(false);
  });

  it("gives the same answer whatever the order of the list", () => {
    const slots = twoStageTwoDays();
    expect(lockRuleHolds([...slots].reverse())).toBe(true);
    const broken = withLocked(slots, 9, false);
    expect(lockRuleHolds([...broken].reverse())).toBe(false);
  });

  it("is false when a time is not a number", () => {
    expect(lockRuleHolds([slot("Park", Number.NaN, 1290, true)])).toBe(false);
    expect(lockRuleHolds([...twoStageDay(), slot("Park", 1200, Number.NaN, false)])).toBe(false);
  });
});

describe("lockLabel and lockRuleLine", () => {
  it("call every lock on the invented day an invented fixed slot, with no rule line", () => {
    expect(lockLabel({ synthetic: true, holds: true })).toBe(LOCK_INVENTED);
    expect(lockLabel({ synthetic: true, holds: false })).toBe(LOCK_INVENTED);
    expect(lockRuleLine({ synthetic: true, holds: true })).toBeNull();
    expect(lockRuleLine({ synthetic: true, holds: false })).toBeNull();
  });

  it("name the last-set rule on a published day where it holds", () => {
    expect(lockLabel({ synthetic: false, holds: true })).toBe(LOCK_SHORT);
    expect(lockRuleLine({ synthetic: false, holds: true })).toBe(LOCK_RULE);
  });

  it("fall back to the generic words on a published day where it does not hold", () => {
    expect(lockLabel({ synthetic: false, holds: false })).toBe(LOCK_GENERIC);
    expect(lockRuleLine({ synthetic: false, holds: false })).toBe(LOCK_RULE_GENERIC);
  });
});
