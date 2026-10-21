/**
 * One wording for locked sets. On the published days the locks are this app's assumption: the server
 * keeps the closing set of each main stage in place. Neither festival marked any set as fixed, so
 * every page that shows a lock says whose lock it is, in these words, and states the last-set rule
 * only when `lockRuleHolds` proves it on that day's slots. The invented day has its own sentence.
 */

/** The rule, stated only where `lockRuleHolds` is true on the published day's slots. */
export const LOCK_RULE =
  "On the published days, the locked sets are the last set on each stage. This app keeps them in place; the festivals did not mark them.";

/** The rule when the locked sets are not exactly the last set on each stage. */
export const LOCK_RULE_GENERIC =
  "On the published days, locked sets are ones this app keeps in place; the festivals did not mark them.";

/** A lock's label on a published day where the rule holds. */
export const LOCK_SHORT = "Locked by this app: the last set on its stage stays in place.";

/** A lock's label on a published day where the rule does not hold. */
export const LOCK_GENERIC = "Locked by this app: kept in place.";

/** A lock's label on the invented day. */
export const LOCK_INVENTED = "Locked: an invented fixed slot.";

/**
 * One set as the lock rule sees it. `start` and `end` are minutes from the day's midnight, so a set
 * after midnight runs past a full day of minutes. Each caller maps its own rows to this shape.
 */
export type LockSlot = { stage: string; day: number; start: number; end: number; locked: boolean };

/** True when `a` comes after `b` on the same stage: a later start, or the same start and a later end. */
function later(a: LockSlot, b: LockSlot): boolean {
  return a.start > b.start || (a.start === b.start && a.end > b.end);
}

/**
 * The equality behind LOCK_RULE: true only when the list is not empty and, on every stage and day that
 * holds a set, the last set (latest start, a tie broken by the latest end) is locked and no other set
 * is. Two sets that share the latest start and end leave no single last set, so the rule cannot be
 * stated and the answer is false; so is a time that is not a number.
 */
export function lockRuleHolds(slots: readonly LockSlot[]): boolean {
  if (!slots.length) return false;
  const lastOn = new Map<string, { slot: LockSlot; tied: boolean }>();
  const key = (s: LockSlot) => JSON.stringify([s.day, s.stage]);
  for (const s of slots) {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) return false;
    const best = lastOn.get(key(s));
    if (!best || later(s, best.slot)) lastOn.set(key(s), { slot: s, tied: false });
    else if (!later(best.slot, s)) best.tied = true;
  }
  return slots.every((s) => {
    const last = lastOn.get(key(s));
    return last !== undefined && !last.tied && s.locked === (s === last.slot);
  });
}

/** The words beside a lock: the invented day's, else the rule's where it holds, else the generic. */
export function lockLabel({ synthetic, holds }: { synthetic: boolean; holds: boolean }) {
  if (synthetic) return LOCK_INVENTED;
  return holds ? LOCK_SHORT : LOCK_GENERIC;
}

/** The one rule line under a published day's locks; the invented day prints none. */
export function lockRuleLine({ synthetic, holds }: { synthetic: boolean; holds: boolean }) {
  if (synthetic) return null;
  return holds ? LOCK_RULE : LOCK_RULE_GENERIC;
}
