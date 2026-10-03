import { describe, expect, it } from "vitest";

import {
  blockDensity,
  columnFrames,
  formatClock,
  formatRange,
  isNavKey,
  layoutLinks,
  linkBulge,
  nextNavItem,
  overlapWindow,
  timeDomain,
  timeScale,
  timeTicks,
  type NavItem,
} from "./timetable";

describe("formatClock", () => {
  it("formats minutes from day start", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(675)).toBe("11:15");
    expect(formatClock(1395)).toBe("23:15");
  });

  it("wraps after-midnight sets", () => {
    expect(formatClock(1530)).toBe("01:30");
    expect(formatClock(1440)).toBe("00:00");
  });

  it("formats a range with an en dash", () => {
    expect(formatRange({ start: 1035, end: 1080 })).toBe("17:15–18:00");
  });
});

describe("timeDomain", () => {
  it("widens to whole hours", () => {
    expect(
      timeDomain([
        { start: 675, end: 720 },
        { start: 1290, end: 1395 },
      ]),
    ).toEqual({ start: 660, end: 1440 });
  });

  it("keeps exact hours", () => {
    expect(timeDomain([{ start: 720, end: 780 }])).toEqual({ start: 720, end: 780 });
  });

  it("falls back to one step when there are no sets", () => {
    expect(timeDomain([])).toEqual({ start: 0, end: 60 });
  });

  it("supports other steps", () => {
    expect(timeDomain([{ start: 700, end: 710 }], 30)).toEqual({ start: 690, end: 720 });
  });
});

describe("timeScale and timeTicks", () => {
  const scale = timeScale({ start: 660, end: 1440 }, 1.5);

  it("maps minutes to pixels from the top of the domain", () => {
    expect(scale.y(660)).toBe(0);
    expect(scale.y(720)).toBe(90);
    expect(scale.height).toBe(1170);
  });

  it("lists every hour, both ends included", () => {
    expect(timeTicks({ start: 660, end: 840 })).toEqual([660, 720, 780, 840]);
    expect(timeTicks({ start: 675, end: 800 })).toEqual([720, 780]);
  });
});

describe("overlapWindow", () => {
  it("returns the shared minutes", () => {
    expect(overlapWindow({ start: 600, end: 660 }, { start: 630, end: 700 })).toEqual({
      start: 630,
      end: 660,
    });
  });

  it("returns null for back-to-back or separate sets", () => {
    expect(overlapWindow({ start: 600, end: 660 }, { start: 660, end: 700 })).toBeNull();
    expect(overlapWindow({ start: 600, end: 620 }, { start: 700, end: 760 })).toBeNull();
  });
});

describe("blockDensity", () => {
  it("steps down as blocks get shorter", () => {
    expect(blockDensity(120)).toBe("full");
    expect(blockDensity(70)).toBe("full");
    expect(blockDensity(50)).toBe("compact");
    expect(blockDensity(30)).toBe("tiny");
  });
});

describe("columnFrames", () => {
  it("splits the width into equal columns with gaps", () => {
    expect(columnFrames(420, 3, 30)).toEqual([
      { left: 0, width: 120 },
      { left: 150, width: 120 },
      { left: 300, width: 120 },
    ]);
  });

  it("handles no columns and too little room", () => {
    expect(columnFrames(400, 0, 10)).toEqual([]);
    expect(columnFrames(10, 3, 20).every((frame) => frame.width === 0)).toBe(true);
  });
});

describe("linkBulge", () => {
  it("is flat between neighbouring stages and rises with distance, up to a cap", () => {
    expect(linkBulge(1)).toBe(0);
    expect(linkBulge(2)).toBe(28);
    expect(linkBulge(3)).toBe(46);
    expect(linkBulge(10)).toBe(64);
  });
});

describe("layoutLinks", () => {
  const columns = columnFrames(420, 3, 30); // columns at 0-120, 150-270, 300-420
  const scale = timeScale({ start: 600, end: 900 }, 2);

  it("joins the facing edges of the two sets at the middle of their shared minutes", () => {
    const [link] = layoutLinks(
      [{ id: "x", colA: 1, colB: 0, window: { start: 660, end: 720 }, weight: 1 }],
      columns,
      scale,
    );
    expect(link.x1).toBe(120);
    expect(link.x2).toBe(150);
    expect(link.y).toBe(180);
    expect(link.badge).toEqual({ x: 135, y: 180 });
    expect(link.path).toBe("M 120 180 L 150 180");
    expect(link.strokeWidth).toBe(7);
    expect(link.opacity).toBe(1);
  });

  it("curves over the stage in between", () => {
    const [link] = layoutLinks(
      [{ id: "x", colA: 0, colB: 2, window: { start: 660, end: 720 }, weight: 0 }],
      columns,
      scale,
    );
    expect(link.x1).toBe(120);
    expect(link.x2).toBe(300);
    // The badge sits in the gutter beside the left-hand set, not over the stage in between.
    expect(link.badge).toEqual({ x: 135, y: 180 });
    expect(link.path).toBe("M 120 180 Q 210 124 300 180");
    expect(link.strokeWidth).toBe(2);
    expect(link.opacity).toBeCloseTo(0.45);
  });

  it("moves a cheaper link's badge off a costlier one's, inside the shared window", () => {
    const links = layoutLinks(
      [
        { id: "cheap", colA: 0, colB: 1, window: { start: 600, end: 720 }, weight: 0.4 },
        { id: "dear", colA: 0, colB: 1, window: { start: 600, end: 720 }, weight: 0.9 },
      ],
      columns,
      scale,
      { badgeSize: 26 },
    );
    // Caller order is kept.
    expect(links.map((link) => link.id)).toEqual(["cheap", "dear"]);
    const [cheap, dear] = links;
    expect(dear.y).toBe(120);
    expect(Math.abs(cheap.y - dear.y)).toBeGreaterThanOrEqual(26);
    expect(cheap.y).toBeGreaterThanOrEqual(0);
    expect(cheap.y).toBeLessThanOrEqual(240);
  });

  it("leaves badges in different gutters alone", () => {
    const [p, q] = layoutLinks(
      [
        { id: "p", colA: 0, colB: 1, window: { start: 600, end: 720 }, weight: 1 },
        { id: "q", colA: 1, colB: 2, window: { start: 600, end: 720 }, weight: 0.5 },
      ],
      columns,
      scale,
    );
    expect(p.y).toBe(q.y);
  });

  it("skips links whose columns are missing or the same", () => {
    expect(
      layoutLinks(
        [
          { id: "same", colA: 1, colB: 1, window: { start: 600, end: 660 }, weight: 1 },
          { id: "missing", colA: 0, colB: 7, window: { start: 600, end: 660 }, weight: 1 },
        ],
        columns,
        scale,
      ),
    ).toEqual([]);
  });
});

describe("nextNavItem", () => {
  const items: NavItem[] = [
    { id: "a1", col: 0, start: 600, end: 660 },
    { id: "a2", col: 0, start: 700, end: 760 },
    { id: "a3", col: 0, start: 800, end: 860 },
    { id: "b1", col: 1, start: 610, end: 640 },
    { id: "b2", col: 1, start: 720, end: 800 },
    { id: "d1", col: 3, start: 790, end: 850 },
  ];

  it("steps through a stage with up and down, stopping at the ends", () => {
    expect(nextNavItem(items, "a2", "ArrowUp")).toBe("a1");
    expect(nextNavItem(items, "a2", "ArrowDown")).toBe("a3");
    expect(nextNavItem(items, "a1", "ArrowUp")).toBeNull();
    expect(nextNavItem(items, "a3", "ArrowDown")).toBeNull();
  });

  it("jumps to the first and last set of a stage", () => {
    expect(nextNavItem(items, "a2", "Home")).toBe("a1");
    expect(nextNavItem(items, "a2", "End")).toBe("a3");
    expect(nextNavItem(items, "a1", "Home")).toBeNull();
  });

  it("moves across to the set playing closest in time", () => {
    expect(nextNavItem(items, "a2", "ArrowRight")).toBe("b2");
    expect(nextNavItem(items, "a1", "ArrowRight")).toBe("b1");
    expect(nextNavItem(items, "b2", "ArrowLeft")).toBe("a2");
  });

  it("skips stages without sets and stops at the edges", () => {
    expect(nextNavItem(items, "b2", "ArrowRight")).toBe("d1");
    expect(nextNavItem(items, "d1", "ArrowRight")).toBeNull();
    expect(nextNavItem(items, "a1", "ArrowLeft")).toBeNull();
  });

  it("starts from the first set when the current one is unknown", () => {
    expect(nextNavItem(items, "nope", "ArrowDown")).toBe("a1");
    expect(nextNavItem([], "nope", "ArrowDown")).toBeNull();
  });

  it("recognises navigation keys", () => {
    expect(isNavKey("ArrowLeft")).toBe(true);
    expect(isNavKey("Enter")).toBe(false);
  });
});
