import { describe, expect, it } from "vitest";

import { HELD_ROOM_LEAD, HELD_ROOM_SCREENS, heldRoomHeight, keepsHeldRoom, trimmedHeldRoom } from "./skeletons";

/**
 * The room a place holds for a late answer (the agent section's recordings, the plan after Keep
 * this move). The browser half (CLS under 0.0005 with the answer held at CPU 4x) is pinned in recorded-runs.spec.ts
 * and try-a-move.spec.ts.
 */
describe("heldRoomHeight", () => {
  it("reaches a lead of a screen past the screen's foot from a place on screen", () => {
    expect(heldRoomHeight(0, 300, 900)).toBe(Math.ceil(900 * (1 + HELD_ROOM_LEAD) - 300));
    // The pending box's 128 px is far short of that: the room is what holds what sits under it off screen.
    expect(heldRoomHeight(128, 500, 844)).toBe(Math.ceil(844 * (1 + HELD_ROOM_LEAD) - 500));
  });

  it("holds nothing more for a place below the screen, and never shrinks", () => {
    expect(heldRoomHeight(0, 900, 900)).toBe(0);
    expect(heldRoomHeight(1100, 1500, 900)).toBe(1100);
    expect(heldRoomHeight(2000, 300, 900)).toBe(2000);
  });

  it("never passes its screens, so an answer that never comes cannot grow the page without end", () => {
    expect(heldRoomHeight(0, -5000, 800)).toBe(HELD_ROOM_SCREENS * 800);
  });

  it("holds what it holds when the screen has no height", () => {
    expect(heldRoomHeight(40, 0, 0)).toBe(40);
  });
});

describe("keepsHeldRoom and trimmedHeldRoom, once the answer is in", () => {
  it("keeps the room while the place is on screen and the answer ends above the screen's foot", () => {
    expect(keepsHeldRoom({ onScreen: true, end: 600, fold: 900 })).toBe(true);
  });

  it("lets it go when that moves nothing on screen: all of it off screen, or the answer's end at or below the foot", () => {
    expect(keepsHeldRoom({ onScreen: false, end: 600, fold: 900 })).toBe(false);
    expect(keepsHeldRoom({ onScreen: true, end: 900, fold: 900 })).toBe(false);
    expect(keepsHeldRoom({ onScreen: true, end: 1400, fold: 900 })).toBe(false);
  });

  it("gives back only the room past the screen's foot, and never more than it held", () => {
    expect(trimmedHeldRoom(1300, 200, 900)).toBe(700);
    expect(trimmedHeldRoom(500, 200, 900)).toBe(500);
    expect(trimmedHeldRoom(1300, 950, 900)).toBe(0);
  });
});
