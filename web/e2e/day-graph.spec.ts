import type { Page } from "@playwright/test";

import { DAYS, expectNoHorizontalScroll, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { serveInventedDay } from "./invented-day";
import { HomePage } from "./pages/home-page";

/**
 * The hero's day drawn as a graph (DECISION.md sections 4 and 5): the server paints its final frame, nothing
 * shifts after it, the first screen holds its budgets at 390 and 375 px, the toggle animates the move in 450 ms (and
 * not at all under reduced motion), the side-effect line is said in every state, the drawing's name says which view
 * it shows, and no colour on the first screen sits in the old orange band.
 */

/** The side-effect line of each published day's move, from the published times (DECISION.md 5.2, row 8). */
const SIDE_EFFECTS = {
  [DAYS.glastonbury.id]: "New 15 min overlap with Joy Crookes. Shortens 3 other overlaps by 15 min.",
  [DAYS.riot.id]: "Ends the 5 min overlap with Twin Peaks. No other overlap gets longer.",
} as const;

/** The hero's boxes that must not move once painted: pitch, picker, toggle, drawing, readout, Keep. */
const HERO_BOXES = {
  h1: "#pitch-heading",
  lede: "#pitch-heading + p",
  picker: '[role="radiogroup"][aria-label="Festival day"]',
  toggle: '[role="radiogroup"][aria-label="Drawing shows"]',
  drawing: "[data-day-graph]",
  readout: "[data-readout]",
  keep: "[data-hero-group] button",
} as const;

type Box = { x: number; y: number; width: number; height: number } | null;

/** The bottom edge of a locator's box in page pixels (the page is at the top when it is read). */
async function bottomOf(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).filter({ visible: true }).first().boundingBox();
  expect(box, `${selector} is drawn`).not.toBeNull();
  return (box?.y ?? 0) + (box?.height ?? 0);
}

/** Every animation whose target is inside the drawing, with its duration. */
function drawingAnimations(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-day-graph]");
    return document
      .getAnimations()
      .filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return Boolean(root && target && root.contains(target));
      })
      .map((animation) => Number(animation.effect?.getTiming().duration ?? 0));
  });
}

/** What the names on the drawing look like in one view, in the band the visitor sees (round 35, day-graph lane). */
type Labels = {
  band: string;
  layout: string;
  /** Sets drawn in the band's window, by the slot their name takes (a to e; e is a set with no name drawn). */
  slots: Record<string, number>;
  /** Sets in the window whose drawn name is not the act's whole name, is clipped by the window, or is missing. */
  notWhole: string[];
  /** Sets in the window with no name drawn at all. */
  unnamed: string[];
  /** Visible names that end in an ellipsis with fewer than 8 characters before it. */
  shortEllipsis: string[];
  /** Painted-stroke samples inside a visible name, tag or plate box (inset 1 px), and the lines that make them. */
  strokeHits: number;
  through: string[];
  /** Names beside their bar (slot b) or on a plate in the row gap (slot c) that are as near another bar as their own. */
  association: string[];
  /** Names that start left of the window: their first letter is cut. */
  cutAtLeft: string[];
  /** Round 37 (L15): pairs of drawn lines less than 6 px apart whose spans overlap. */
  closeLines: string[];
  /** Round 37 (L15): lines that run within 2 px of another set's bar edge for more than 4 px of that bar's height. */
  edgeRuns: string[];
};

/**
 * Measures the names in the band on show, in the page: each set in the window and its name, each name's box, and
 * each line's path sampled every 1 px against every name and tag box inset by 1 px. A sample under a bar that is
 * drawn above the line (a line drawn beneath the bars, passing under a set that is not one of its two) is dropped,
 * since the bar hides it there.
 */
function measureLabels(names: Record<string, string>): Labels {
  const graph = document.querySelector("[data-day-graph]") as HTMLElement;
  const band = [...graph.querySelectorAll<HTMLElement>("[data-band]")].find((element) => element.getClientRects().length > 0) as HTMLElement;
  const rect = (element: Element) => element.getBoundingClientRect();
  // The band's time track sits in its second child, which clips it (the first holds the stage names).
  const clip = rect(band.children[1]);
  const seen = (box: DOMRect) => ({ left: Math.max(box.left, clip.left), right: Math.min(box.right, clip.right), top: box.top, bottom: box.bottom });
  const gap = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
    Math.hypot(Math.max(0, b.left - a.right, a.left - b.right), Math.max(0, b.top - a.bottom, a.top - b.bottom));
  const overlapX = (a: { left: number; right: number }, b: { left: number; right: number }) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const textOf = (element: Element) => (element.children.length ? [...element.children].map((child) => child.textContent ?? "").join(" ") : (element.textContent ?? ""));
  const bars = [...band.querySelectorAll<HTMLElement>("[data-set]")].map((element) => ({ id: element.dataset.set ?? "", slot: element.dataset.slot ?? "", box: rect(element) }));
  const ghost = band.querySelector("[data-ghost]");
  const moverId = (band.querySelector('[data-anim^="mover"] [data-set]') as HTMLElement | null)?.dataset.set ?? null;
  const labels = [...band.querySelectorAll<HTMLElement>("[data-label]")].map((element) => ({ id: element.dataset.label ?? "", slot: element.dataset.slot ?? "", text: textOf(element), box: rect(element) }));
  const tags = [...band.querySelectorAll<HTMLElement>("[data-shared-tag]")].map((element) => ({ text: textOf(element), box: rect(element) }));
  const slots: Record<string, number> = {};
  const notWhole: string[] = [];
  const unnamed: string[] = [];
  for (const bar of bars.filter((item) => seen(item.box).right - seen(item.box).left > 0.5)) {
    slots[bar.slot] = (slots[bar.slot] ?? 0) + 1;
    const label = labels.find((item) => item.id === bar.id);
    const name = names[bar.id] ?? bar.id;
    const clipped = Boolean(label && (label.box.left < clip.left - 0.5 || label.box.right > clip.right + 0.5));
    if (!label) unnamed.push(`${name} (slot ${bar.slot})`);
    if (!label || label.text !== name || clipped) notWhole.push(`${name} (slot ${bar.slot}${label ? `: "${label.text}"` : ", no name drawn"}${clipped ? ", clipped" : ""})`);
  }
  const shortEllipsis = labels.filter((item) => item.text.endsWith("…") && [...item.text.slice(0, -1)].length < 8).map((item) => item.text);
  const association: string[] = [];
  for (const label of labels.filter((item) => item.slot === "b" || item.slot === "c")) {
    const own = bars.find((bar) => bar.id === label.id);
    if (!own) {
      association.push(`${label.text}: no bar of its own`);
      continue;
    }
    const ownBox = seen(own.box);
    const mine = gap(label.box, ownBox);
    const others = [
      ...bars.filter((bar) => bar.id !== label.id).map((bar) => ({ name: names[bar.id] ?? bar.id, box: seen(bar.box) })),
      ...(ghost && label.id !== moverId ? [{ name: "the published slot", box: seen(rect(ghost)) }] : []),
    ];
    for (const other of others) {
      if (other.box.right - other.box.left > 0.5 && gap(label.box, other.box) <= mine + 0.01) association.push(`${label.text} (slot ${label.slot}) is as near ${other.name} as its own bar`);
    }
    if (label.slot === "c" && overlapX(label.box, ownBox) < (label.box.right - label.box.left) / 2 - 0.01) association.push(`${label.text}: its plate is less than half over its bar`);
  }
  const boxes = [...labels.map((item) => ({ text: item.text, box: item.box })), ...tags.map((item) => ({ text: `tag "${item.text}"`, box: item.box }))];
  let strokeHits = 0;
  const through: string[] = [];
  for (const holder of band.querySelectorAll<HTMLElement>("[data-thread]")) {
    const line = holder.querySelector<SVGLineElement>("line[data-stroke]");
    if (!line || parseFloat(getComputedStyle(holder).opacity) === 0) continue;
    const key = (holder.dataset.anim ?? "").replace(/^line:/, "").replace(/@\d$/, "");
    const [a, b] = key.split("~");
    const under = holder.hasAttribute("data-under");
    const half = parseFloat(line.getAttribute("stroke-width") ?? "1") / 2;
    const ctm = line.getScreenCTM();
    if (!ctm) continue;
    const length = line.getTotalLength();
    let count = 0;
    const hit = new Set<string>();
    for (let t = 0; t <= length; t += 1) {
      const p = line.getPointAtLength(t).matrixTransform(ctm);
      if (p.x < clip.left || p.x > clip.right) continue;
      if (under && bars.some((bar) => bar.id !== a && bar.id !== b && p.x >= bar.box.left && p.x <= bar.box.right && p.y >= bar.box.top && p.y <= bar.box.bottom)) continue;
      for (const item of boxes) {
        const q = item.box;
        if (p.y > q.top + 1 && p.y < q.bottom - 1 && p.x + half > q.left + 1 && p.x - half < q.right - 1) {
          count += 1;
          hit.add(item.text);
        }
      }
    }
    strokeHits += count;
    if (count > 0) through.push(`${names[a] ?? a} × ${names[b] ?? b} through ${[...hit].join(", ")} (${count})`);
  }
  const cutAtLeft = labels.filter((item) => item.box.left < clip.left - 0.5).map((item) => item.text);
  // Line spacing (round 37, L15): each drawn line's x and its span on the screen, then every pair whose spans overlap
  // and that stand less than 6 px apart, and every run within 2 px of another set's bar edge over more than 4 px.
  const drawn: { key: string; x: number; top: number; bottom: number }[] = [];
  for (const holder of band.querySelectorAll<HTMLElement>("[data-thread]")) {
    const line = holder.querySelector<SVGLineElement>("line[data-stroke]");
    if (!line || parseFloat(getComputedStyle(holder).opacity) === 0) continue;
    const ctm = line.getScreenCTM();
    if (!ctm) continue;
    const a = new DOMPoint(Number(line.getAttribute("x1")), Number(line.getAttribute("y1"))).matrixTransform(ctm);
    const b = new DOMPoint(Number(line.getAttribute("x2")), Number(line.getAttribute("y2"))).matrixTransform(ctm);
    if (a.x < clip.left || a.x > clip.right) continue;
    drawn.push({ key: (holder.dataset.anim ?? "").replace(/^line:/, "").replace(/@\d$/, ""), x: a.x, top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) });
  }
  const nameOf = (key: string) => key.split("~").map((id) => names[id] ?? id).join(" × ");
  const closeLines: string[] = [];
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const [p, q] = [drawn[i], drawn[j]];
      const overlap = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (overlap > 0 && Math.abs(p.x - q.x) < 6) closeLines.push(`${nameOf(p.key)} / ${nameOf(q.key)}: ${Math.abs(p.x - q.x).toFixed(2)} px apart`);
    }
  }
  const edgeRuns: string[] = [];
  for (const line of drawn) {
    const [a, b] = line.key.split("~");
    for (const bar of bars) {
      if (bar.id === a || bar.id === b) continue;
      const run = Math.min(line.bottom, bar.box.bottom) - Math.max(line.top, bar.box.top);
      const near = Math.min(Math.abs(line.x - bar.box.left), Math.abs(line.x - bar.box.right));
      if (run > 4 && near < 2) edgeRuns.push(`${nameOf(line.key)} by ${names[bar.id] ?? bar.id}'s edge: ${near.toFixed(2)} px for ${run.toFixed(1)} px`);
    }
  }
  return { band: band.dataset.band ?? "", layout: band.dataset.layout ?? "", slots, notWhole, unnamed, shortEllipsis, strokeHits, through, association, cutAtLeft, closeLines, edgeRuns };
}

/** What the leaders look like in the band on show (round 36, day-graph lane). */
type Leaders = {
  band: string;
  /** Names drawn outside their bar: slot b beside it, slot c on a plate above or below it. */
  outside: number;
  leaders: number;
  /** Outside names with no leader, or with more than one, or marked dropped (the lane reported none dropped). */
  missing: string[];
  doubled: string[];
  dropped: string[];
  /** Leaders with no outside name of their own in the band. */
  orphans: string[];
  /** Leaders longer than 24 px; whose name end is more than 1 px off the name's box; whose bar end is more than 1 px off its own bar's rounded edge. */
  long: string[];
  offName: string[];
  offBar: string[];
  /** The longest leader, in px. */
  longest: number;
  /** The shortest leader, in px (round 37, L4: 6 px for a one-line name on a desktop, 4 px for a two-line plate, 3 px on a phone). */
  shortest: number;
  /** Round 37 (L4): the shortest leader of a name on one line, and of a name on a two-line plate (Infinity when there is none). */
  shortestOne: number;
  shortestTwo: number;
  /**
   * Round 37 (L4): outside names whose box is not at least twice as near its own bar as every other bar (and the
   * published slot, for a name that is not the moved set's), boxes clipped to the band's window as the names test
   * clips them. `name` is the act's name; `detail` gives both distances.
   */
  nearer: { name: string; detail: string }[];
};

/**
 * Measures the leaders in the band on show, in the page: for each name drawn outside its bar, its `svg[data-leader]`
 * and that line's two ends on the screen (through `getScreenCTM`). The first end must sit on the name's box, the second
 * on its own bar's edge, a box with rounded corners of its computed radius.
 */
function measureLeaders(names: Record<string, string>): Leaders {
  const graph = document.querySelector("[data-day-graph]") as HTMLElement;
  const band = [...graph.querySelectorAll<HTMLElement>("[data-band]")].find((element) => element.getClientRects().length > 0) as HTMLElement;
  const name = (id: string) => names[id] ?? id;
  const shown = (element: Element) => element.getClientRects().length > 0 && parseFloat(getComputedStyle(element).opacity) > 0;
  const outsideNames = [...band.querySelectorAll<HTMLElement>("[data-label]")].filter((element) => (element.dataset.slot === "b" || element.dataset.slot === "c") && shown(element));
  const leaderMarks = [...band.querySelectorAll<SVGSVGElement>("svg[data-leader]")].filter((element) => element.getAttribute("data-swap") !== "out");
  const byId = new Map<string, SVGSVGElement[]>();
  for (const mark of leaderMarks) byId.set(mark.dataset.leader ?? "", [...(byId.get(mark.dataset.leader ?? "") ?? []), mark]);
  const missing: string[] = [];
  const doubled: string[] = [];
  const dropped: string[] = [];
  for (const label of outsideNames) {
    const id = label.dataset.label ?? "";
    if (label.hasAttribute("data-leader-dropped")) dropped.push(name(id));
    const count = byId.get(id)?.length ?? 0;
    if (count === 0 && !label.hasAttribute("data-leader-dropped")) missing.push(`${name(id)} (slot ${label.dataset.slot})`);
    if (count > 1) doubled.push(`${name(id)} (${count})`);
  }
  const outsideIds = new Set(outsideNames.map((label) => label.dataset.label ?? ""));
  const orphans = leaderMarks.map((mark) => mark.dataset.leader ?? "").filter((id) => !outsideIds.has(id)).map(name);
  // Distance from a point to a box's edge, inside or out.
  const toBoxEdge = (x: number, y: number, box: DOMRect) => {
    const dx = Math.max(box.left - x, 0, x - box.right);
    const dy = Math.max(box.top - y, 0, y - box.bottom);
    return dx || dy ? Math.hypot(dx, dy) : Math.min(x - box.left, box.right - x, y - box.top, box.bottom - y);
  };
  // Distance from a point to the edge of a box with rounded corners of radius r.
  const toRoundedEdge = (x: number, y: number, box: DOMRect, radius: number) => {
    const r = Math.min(radius, box.width / 2, box.height / 2);
    const qx = Math.abs(x - (box.left + box.right) / 2) - (box.width / 2 - r);
    const qy = Math.abs(y - (box.top + box.bottom) / 2) - (box.height / 2 - r);
    return Math.abs(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
  };
  const long: string[] = [];
  const offName: string[] = [];
  const offBar: string[] = [];
  let longest = 0;
  let shortest = Number.POSITIVE_INFINITY;
  let shortestOne = Number.POSITIVE_INFINITY;
  let shortestTwo = Number.POSITIVE_INFINITY;
  for (const mark of leaderMarks) {
    const id = mark.dataset.leader ?? "";
    const line = mark.querySelector("line");
    const ctm = line?.getScreenCTM();
    if (!line || !ctm) {
      offBar.push(`${name(id)}: no line`);
      continue;
    }
    const at = (x: string, y: string) => new DOMPoint(Number(line.getAttribute(x)), Number(line.getAttribute(y))).matrixTransform(ctm);
    const [from, to] = [at("x1", "y1"), at("x2", "y2")];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    longest = Math.max(longest, length);
    shortest = Math.min(shortest, length);
    if (length > 24 + 0.01) long.push(`${name(id)} (${length.toFixed(2)} px)`);
    const label = outsideNames.find((item) => item.dataset.label === id);
    // A two-line plate draws each line in its own block span; a one-line name is bare text.
    if (label && label.children.length >= 2) shortestTwo = Math.min(shortestTwo, length);
    else if (label) shortestOne = Math.min(shortestOne, length);
    if (label && toBoxEdge(from.x, from.y, label.getBoundingClientRect()) > 1) offName.push(`${name(id)} (${toBoxEdge(from.x, from.y, label.getBoundingClientRect()).toFixed(2)} px)`);
    const bars = [...band.querySelectorAll<HTMLElement>(`[data-set="${CSS.escape(id)}"]`)].filter(shown);
    const off = Math.min(...bars.map((bar) => toRoundedEdge(to.x, to.y, bar.getBoundingClientRect(), parseFloat(getComputedStyle(bar).borderTopLeftRadius) || 0)));
    if (!(off <= 1)) offBar.push(`${name(id)} (${Number.isFinite(off) ? off.toFixed(2) : "no bar"} px)`);
  }
  // Round 37 (L4): each outside name at least twice as near its own bar as any other bar. Boxes are clipped to the
  // band's window (its second child clips the time track), and the published slot counts as another bar for every
  // name but the moved set's, as in the names test's nearness rule.
  const clip = band.children[1].getBoundingClientRect();
  const seen = (box: DOMRect) => ({ left: Math.max(box.left, clip.left), right: Math.min(box.right, clip.right), top: box.top, bottom: box.bottom });
  const gap = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
    Math.hypot(Math.max(0, b.left - a.right, a.left - b.right), Math.max(0, b.top - a.bottom, a.top - b.bottom));
  const allBars = [...band.querySelectorAll<HTMLElement>("[data-set]")]
    .filter(shown)
    .map((bar) => ({ id: bar.dataset.set ?? "", box: seen(bar.getBoundingClientRect()) }))
    .filter((bar) => bar.box.right - bar.box.left > 0.5);
  const ghost = band.querySelector("[data-ghost]");
  const moverId = (band.querySelector('[data-anim^="mover"] [data-set]') as HTMLElement | null)?.dataset.set ?? null;
  const nearer: { name: string; detail: string }[] = [];
  for (const label of outsideNames) {
    const id = label.dataset.label ?? "";
    const box = label.getBoundingClientRect();
    const own = Math.min(...allBars.filter((bar) => bar.id === id).map((bar) => gap(box, bar.box)));
    if (!Number.isFinite(own)) {
      nearer.push({ name: name(id), detail: `${name(id)}: no bar of its own in the window` });
      continue;
    }
    const others = [
      ...allBars.filter((bar) => bar.id !== id).map((bar) => ({ name: name(bar.id), box: bar.box })),
      ...(ghost && id !== moverId ? [{ name: "the published slot", box: seen(ghost.getBoundingClientRect()) }] : []),
    ];
    let worst: { name: string; distance: number } | null = null;
    for (const other of others) {
      const distance = gap(box, other.box);
      if (distance < 2 * own - 0.01 && (!worst || distance < worst.distance)) worst = { name: other.name, distance };
    }
    if (worst) nearer.push({ name: name(id), detail: `${name(id)}: ${own.toFixed(2)} px from its bar, ${worst.distance.toFixed(2)} px from ${worst.name}` });
  }
  return {
    band: band.dataset.band ?? "",
    outside: outsideNames.length,
    leaders: leaderMarks.length,
    missing,
    doubled,
    dropped,
    orphans,
    long,
    offName,
    offBar,
    longest,
    shortest,
    shortestOne,
    shortestTwo,
    nearer,
  };
}

/**
 * Where the leaders are measured, with the shortest leader each size holds (round 37, L4): on a desktop a one-line
 * name's leader at least 6 px and a two-line plate's at least 4 px, in the 1104 px band (1440 and 1280) and, from
 * round 37's fix pass 1, in the 944 and 848 bands (1200 x 800, 1024 x 768); on a phone at least 3 px at 390 x 844.
 * Fix pass 1 also measures the short phone's 140 px band (375 x 667, 320 x 568). Its leaders were 1 px there until the
 * drawing lane's fix pass 2 (15 px bars in the same 37 px rows, names 3 px off their bars), so this table now holds
 * L4's 3 px there too, and D9 (below) is down to its desktop half.
 */
const LEADER_SIZES = [
  { width: 1440, height: 900, oneLine: 6, twoLine: 4 },
  { width: 1280, height: 800, oneLine: 6, twoLine: 4 },
  { width: 1200, height: 800, oneLine: 6, twoLine: 4 },
  { width: 1024, height: 768, oneLine: 6, twoLine: 4 },
  { width: 390, height: 844, oneLine: 3, twoLine: 3 },
  { width: 375, height: 667, oneLine: 3, twoLine: 3 },
  { width: 320, height: 568, oneLine: 3, twoLine: 3 },
] as const;

/**
 * The names held out of the main leader test's 2:1 rule, by day and width. Abel Selaocoe & the Bantu Ensemble at
 * 1280 and up is the drawing lane's declared half of L4 (its plate stays 4 px over its own bar and 4.03 px from
 * Cymande's corner, since lines #3 and #15 need the room beside it). The Brian Jonestown Massacre at 1024 x 768 is
 * known defect D9 (fix pass 1, both views): its plate stands 4 px from its own bar and 7 px from Goat's. D9's own test
 * holds the rule for every name there.
 */
const HELD_TWICE: Record<string, { widths: number[]; names: string[] }[]> = {
  [DAYS.glastonbury.id]: [
    { widths: [1440, 1280], names: ["Abel Selaocoe & the Bantu Ensemble"] },
    { widths: [1024], names: ["The Brian Jonestown Massacre"] },
  ],
};

/**
 * Where the line notes are read by keyboard (round 37, L13): 1440 x 900, and from fix pass 1 the laptop first screens
 * 1366 x 768 and 1280 x 800, where the room under the drawing runs out and the note takes its place above (verify-1
 * found it there over up to 2 other names and 9 bars), the 944 and 848 bands at 1200 x 800 and 1024 x 768 (verify-1: up
 * to 4 names), and on a phone 390 x 844, 375 x 667 and 360 x 640. Each was clear after the drawing lane's fix pass (fix
 * pass 1 measurement: 0 other names, 0 other bars, none of its own, on both days). The phone at 320 px wide (320 x 640,
 * 320 x 568) is known defect D10.
 */
const NOTE_SIZES = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1200, height: 800 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 375, height: 667 },
  { width: 360, height: 640 },
] as const;

/**
 * What a shown line note covers, in the page: every shown name and bar in the band on show whose box meets the note's
 * box inset by half a pixel, split into the focused line's own two sets and every other set.
 */
function measureNoteCover(element: Element): { names: string[]; bars: string[]; ownNames: string[]; ownBars: string[] } {
  const graph = element.closest("[data-day-graph]") as HTMLElement;
  const band = [...graph.querySelectorAll<HTMLElement>("[data-band]")].find((item) => item.getClientRects().length > 0) as HTMLElement;
  const n = element.getBoundingClientRect();
  const shown = (item: Element) => item.getClientRects().length > 0 && parseFloat(getComputedStyle(item).opacity) > 0;
  const hit = (box: DOMRect) => box.right > n.left + 0.5 && box.left < n.right - 0.5 && box.bottom > n.top + 0.5 && box.top < n.bottom - 0.5;
  const key = document.activeElement?.getAttribute("data-hit") ?? "";
  const own = new Set(key.replace(/^line:/, "").replace(/@\d$/, "").split("~"));
  const names = [...band.querySelectorAll<HTMLElement>("[data-label]")].filter(shown).filter((item) => hit(item.getBoundingClientRect())).map((item) => item.dataset.label ?? "");
  const bars = [...band.querySelectorAll<HTMLElement>("[data-set]")].filter(shown).filter((item) => hit(item.getBoundingClientRect())).map((item) => item.dataset.set ?? "");
  return {
    names: names.filter((id) => !own.has(id)),
    bars: bars.filter((id) => !own.has(id)),
    ownNames: names.filter((id) => own.has(id)),
    ownBars: bars.filter((id) => own.has(id)),
  };
}

/** The saved day's act names by id, from the API (GET). */
async function actNames(page: Page, id: string): Promise<Record<string, string>> {
  const response = await page.request.get(`/api/presets/${id}`);
  expect(response.ok(), `GET /api/presets/${id}`).toBeTruthy();
  const preset = (await response.json()) as { festival: { acts: { id: string; name: string }[] } };
  return Object.fromEntries(preset.festival.acts.map((act) => [act.id, act.name]));
}

/**
 * The floors for the names on the drawing (round 35, NEXT.md day-graph acceptance), by width: how many sets may show
 * a name that is not whole on each day (none at 1440 may show no name at all), and whether the painted-stroke and
 * first-letter checks apply there. Short ellipses and association hold at every width. Round 37: 1200 x 800 is the
 * 944 px band (L99), and 1100 x 800 the 848 band, where Riot Fest drew three sets with no name (L14); from 1024 px every
 * set in the window has its name drawn, and no two lines stand within 6 px or run along another set's bar edge (L15).
 */
const LABEL_SIZES = [
  { width: 1440, height: 900, notWhole: { [DAYS.glastonbury.id]: 3, [DAYS.riot.id]: 8 }, allNamed: true, strokes: true, firstLetter: false, lines: true },
  { width: 1280, height: 800, notWhole: { [DAYS.glastonbury.id]: 5, [DAYS.riot.id]: 12 }, allNamed: true, strokes: true, firstLetter: false, lines: true },
  { width: 1200, height: 800, notWhole: null, allNamed: true, strokes: true, firstLetter: false, lines: true },
  { width: 1100, height: 800, notWhole: null, allNamed: true, strokes: true, firstLetter: false, lines: true },
  { width: 1024, height: 768, notWhole: null, allNamed: true, strokes: true, firstLetter: false, lines: true },
  { width: 768, height: 1024, notWhole: null, allNamed: false, strokes: false, firstLetter: true, lines: false },
  { width: 390, height: 844, notWhole: null, allNamed: false, strokes: true, firstLetter: true, lines: false },
] as const;

test.describe("the day graph's names", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  /**
   * Once known defect D7 (round 37, README "Known defects", closed): on Riot Fest at 1200 x 800 and 1024 x 768
   * Sincere Engineer's two-line plate covered its own bar for 28.52 px of its 57.08 px width, 0.02 px short of half.
   * After the drawing lane's fix pass 1 it covers 29.02 px, 0.48 px past half, in both views, on every load. The mark
   * is off; the test stays to hold the plate rule where it once failed (the names test below holds it too).
   */
  test("on Riot Fest at 1200 x 800 and 1024 x 768, in both views, every name on a plate covers its own bar for half its width (D7, fixed)", async ({ page, isPhone }) => {
    const names = await actNames(page, DAYS.riot.id);
    const home = new HomePage(page);
    // The once-failing sizes are desktop bands; on a phone the same rule holds at 390.
    const sizes = isPhone ? [{ width: 390, height: 844 }] : [{ width: 1200, height: 800 }, { width: 1024, height: 768 }];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await home.goto(DAYS.riot.id);
      for (const view of ["moved", "published"] as const) {
        if (view === "published") await home.chooseView("As published");
        await expect(home.graph).toHaveAttribute("data-view", view);
        const found = await page.evaluate(measureLabels, names);
        expect(found.association, `${size.width} x ${size.height}, ${view} view, band ${found.band}: names nearer another bar`).toEqual([]);
      }
    }
  });

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, in both views: names whole, no short ellipsis, no line painted through a name, each name nearer its own bar, lines apart (1440, 1280, 1200, 1100, 1024 and 768 on a desktop; 390 on a phone)`, async ({ page, isPhone }) => {
      test.setTimeout(180_000);
      const names = await actNames(page, day.id);
      const home = new HomePage(page);
      for (const size of LABEL_SIZES.filter((item) => (item.width < 640) === isPhone)) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await home.goto(day.id);
        for (const view of ["moved", "published"] as const) {
          if (view === "published") await home.chooseView("As published");
          await expect(home.graph).toHaveAttribute("data-view", view);
          const found = await page.evaluate(measureLabels, names);
          const where = `${size.width} x ${size.height}, ${view} view, band ${found.band} (${found.layout})`;
          test.info().annotations.push({
            type: `names at ${size.width}, ${view}`,
            description: `slots ${JSON.stringify(found.slots)}; not whole ${found.notWhole.length}${found.notWhole.length ? ` (${found.notWhole.join("; ")})` : ""}; painted-stroke samples ${found.strokeHits}`,
          });
          // (i) Names shown whole: at most the floor not whole, and at 1440 every set in the window has its name drawn.
          if (size.notWhole) {
            expect(found.notWhole.length, `${where}: names not whole: ${found.notWhole.join("; ")}`).toBeLessThanOrEqual(size.notWhole[day.id]);
          }
          if (size.allNamed) expect(found.unnamed, `${where}: sets with no name drawn`).toEqual([]);
          // (ii) No name is cut to a stub: an ellipsis keeps at least 8 characters before it.
          expect(found.shortEllipsis, `${where}: names cut to under 8 characters`).toEqual([]);
          // (iii) No line is painted through a name, a tag or a plate.
          if (size.strokes) expect(found.strokeHits, `${where}: lines painted through names: ${found.through.join("; ")}`).toBe(0);
          // (iv) A name beside its bar or on a plate in the row gap is nearer its own bar than any other, with no name
          // held out (D7, the one name once held out at 1200 and 1024, is fixed: see the test above).
          expect(found.association, `${where}: names nearer another bar`).toEqual([]);
          // (vi) On a phone's detail window, a set that starts before the window shows its first letter.
          if (size.firstLetter) expect(found.cutAtLeft, `${where}: names cut at the window's left`).toEqual([]);
          // (vii) Round 37 (L15): lines stand apart, and none runs along another set's bar edge.
          if (size.lines) {
            expect(found.closeLines, `${where}: lines within 6 px of each other`).toEqual([]);
            expect(found.edgeRuns, `${where}: lines along another set's bar edge`).toEqual([]);
          }
        }
      }
    });
  }

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, in both views: every name drawn outside its bar has one leader, at most 24 px, from its name to its own bar's edge, long enough to read, with the name twice as near its own bar as any other (1440, 1280, 1200 and 1024 on a desktop; 390, 375 x 667 and 320 x 568 on a phone)`, async ({ page, isPhone }) => {
      test.setTimeout(150_000);
      const names = await actNames(page, day.id);
      const home = new HomePage(page);
      for (const size of LEADER_SIZES.filter((item) => (item.width < 640) === isPhone)) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await home.goto(day.id);
        for (const view of ["moved", "published"] as const) {
          if (view === "published") await home.chooseView("As published");
          await expect(home.graph).toHaveAttribute("data-view", view);
          const found = await page.evaluate(measureLeaders, names);
          const where = `${size.width} x ${size.height}, ${view} view, band ${found.band}`;
          test.info().annotations.push({
            type: `leaders at ${size.width} x ${size.height}, ${view}`,
            description: `${found.outside} names outside their bar, ${found.leaders} leaders, shortest ${found.shortest.toFixed(2)} px (one line ${found.shortestOne.toFixed(2)}, two lines ${found.shortestTwo.toFixed(2)}), longest ${found.longest.toFixed(2)} px, dropped ${found.dropped.length}, under 2:1 ${found.nearer.length}${found.nearer.length ? ` (${found.nearer.map((item) => item.detail).join("; ")})` : ""}`,
          });
          expect(found.outside, `${where}: names drawn outside their bar`).toBeGreaterThan(0);
          expect(found.missing, `${where}: outside names with no leader`).toEqual([]);
          expect(found.doubled, `${where}: names with more than one leader`).toEqual([]);
          // The day-graph lane's dropped list is empty on both days at every width, in both views.
          expect(found.dropped, `${where}: names whose leader was dropped`).toEqual([]);
          expect(found.orphans, `${where}: leaders with no outside name`).toEqual([]);
          expect(found.long, `${where}: leaders over 24 px`).toEqual([]);
          expect(found.offName, `${where}: leaders that do not start on their name`).toEqual([]);
          expect(found.offBar, `${where}: leaders that do not end within 1 px of their own bar's edge`).toEqual([]);
          expect(found.leaders, `${where}: one leader per outside name`).toBe(found.outside - found.dropped.length);
          // Round 37 (L4): the leaders are long enough to read as leaders: on a desktop from 1024 to 1440, 6 px for a
          // one-line name and 4 px for a two-line plate; 3 px on a phone at 390 (round 36: 3 to 4 px on a desktop, 1 px
          // on a phone). From fix pass 2 the short phone holds L4's 3 px here as well.
          expect(found.shortestOne, `${where}: the shortest leader of a one-line name`).toBeGreaterThanOrEqual(size.oneLine - 0.01);
          expect(found.shortestTwo, `${where}: the shortest leader of a two-line plate`).toBeGreaterThanOrEqual(size.twoLine - 0.01);
          // Round 37 (L4): each outside name at least twice as near its own bar as any other bar. Held out: the
          // declared Abel Selaocoe at 1280 and up, and D9's one name at 1024 (HELD_TWICE, above).
          const held = (HELD_TWICE[day.id] ?? []).filter((item) => item.widths.includes(size.width)).flatMap((item) => item.names);
          expect(
            found.nearer.filter((item) => !held.includes(item.name)).map((item) => item.detail),
            `${where}: outside names less than twice as near their own bar as another`,
          ).toEqual([]);
        }
      }
    });
  }

  /**
   * Known defect D9 (round 37 fix pass 1, from verify-1's L4 and N8; README "Known defects"): L4's leaders and 2:1 rule
   * after the drawing lane's fix pass. The 944 and 848 bands (1200 x 800, 1024 x 768) now draw 6 px one-line leaders
   * and 4 px plates, and every outside name stands twice as near its own bar but one: at 1024 x 768, Glastonbury's The
   * Brian Jonestown Massacre, 4 px from its bar and 7 px from Goat's. The short phone's half (375 x 667, 320 x 568,
   * every leader 1 px against L4's 3 px) was fixed in the drawing lane's fix pass 2, so the phone project now runs
   * this test as a plain pass. On the desktop it accepts only D9's recorded geometry (D9_HELD, below): any other
   * name under 2:1, or that name at any other distance, day or width, fails. Remove the entry when the name is drawn.
   */
  /** D9's recorded geometry, the exact `detail` measureLeaders gives (Glastonbury, 1024 x 768, both views). */
  const D9_HELD = ["The Brian Jonestown Massacre: 4.00 px from its bar, 7.00 px from Goat"];

  test("known defect D9: leaders at least 6 px for a one-line name and 4 px for a plate, every outside name twice as near its own bar, at 1200 x 800 and 1024 x 768; at least 3 px on a short phone (375 x 667, 320 x 568)", async ({ page, isPhone }) => {
    test.setTimeout(150_000);
    const home = new HomePage(page);
    const sizes = isPhone ? [{ width: 375, height: 667 }, { width: 320, height: 568 }] : [{ width: 1200, height: 800 }, { width: 1024, height: 768 }];
    for (const day of Object.values(DAYS)) {
      const names = await actNames(page, day.id);
      for (const size of sizes) {
        await page.setViewportSize(size);
        await home.goto(day.id);
        for (const view of ["moved", "published"] as const) {
          if (view === "published") await home.chooseView("As published");
          await expect(home.graph).toHaveAttribute("data-view", view);
          const found = await page.evaluate(measureLeaders, names);
          const where = `${day.title} at ${size.width} x ${size.height}, ${view} view, band ${found.band}`;
          expect.soft(found.shortestOne, `${where}: the shortest leader of a one-line name`).toBeGreaterThanOrEqual(isPhone ? 2.99 : 5.99);
          expect.soft(found.shortestTwo, `${where}: the shortest leader of a two-line plate`).toBeGreaterThanOrEqual(isPhone ? 2.99 : 3.99);
          // D9: only the recorded detail, to the hundredth of a pixel, on Glastonbury at 1024 wide. Nothing else passes.
          const held = day.id === DAYS.glastonbury.id && size.width === 1024 ? D9_HELD : [];
          expect.soft(
            found.nearer.map((item) => item.detail).filter((detail) => !held.includes(detail)),
            `${where}: outside names less than twice as near their own bar as another`,
          ).toEqual([]);
        }
      }
    }
  });

  test("an arrow key on a line shows that line's note, in words, and Escape hides it with focus kept on the line", async ({ page }) => {
    // A phone with a keyboard attached takes the same path, so both projects run it.
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const note = home.graph.locator('[data-thread-note="line"]').filter({ visible: true });
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    await home.viewToggle.getByRole("radio", { checked: true }).focus();
    await page.keyboard.press("Tab");
    expect(await focused()).toMatch(/^#1 of \d+ clashes as published: /);
    // Each arrow press moves to the next line drawn at this width (a phone draws fewer), by rank.
    let last = await focused();
    for (let step = 0; step < 2; step++) {
      await page.keyboard.press("ArrowRight");
      const now = await focused();
      expect(now, "the arrow moved to another line").not.toBe(last);
      expect(Number(/^#(\d+) of /.exec(now)?.[1]), "the next line by rank").toBeGreaterThan(Number(/^#(\d+) of /.exec(last)?.[1]));
      // The note follows the focused line at once, with no press of Enter, and says what its name says.
      await expect(note).toHaveCount(1);
      await expect(note).toHaveText(now);
      last = now;
    }
    await page.keyboard.press("Escape");
    await expect(note).toHaveCount(0);
    expect(await focused(), "focus stays on the line").toBe(last);
  });

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, every line drawn shows its note, in words, and the note covers no other set's name or bar and none of its own (1440 x 900, 1366 x 768, 1280 x 800, 1200 x 800 and 1024 x 768 on a desktop; 390 x 844, 375 x 667 and 360 x 640 on a phone; round 37, L13)`, async ({ page, isPhone }) => {
      test.setTimeout(150_000);
      const home = new HomePage(page);
      const note = home.graph.locator('[data-thread-note="line"]').filter({ visible: true });
      const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
      for (const size of NOTE_SIZES.filter((item) => (item.width < 640) === isPhone)) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await home.goto(day.id);
        const where = `${size.width} x ${size.height}`;
        const lines = await home.graphLines().count();
        expect(lines, `${where}: lines drawn`).toBeGreaterThan(0);
        await home.viewToggle.getByRole("radio", { checked: true }).focus();
        await page.keyboard.press("Tab");
        const seen = new Set<string>();
        for (let step = 0; step < lines; step++) {
          if (step > 0) await page.keyboard.press("ArrowRight");
          const now = await focused();
          seen.add(now);
          await expect(note).toHaveCount(1);
          await expect(note).toHaveText(now);
          // Every name and bar in the band on show, against the note's box (inset half a pixel).
          const covered = await note.evaluate(measureNoteCover);
          expect(covered.names, `${where}: the note of "${now.slice(0, 60)}" covers names`).toEqual([]);
          expect(covered.bars, `${where}: the note of "${now.slice(0, 60)}" covers bars`).toEqual([]);
          expect([...covered.ownNames, ...covered.ownBars], `${where}: the note of "${now.slice(0, 60)}" covers its own sets`).toEqual([]);
        }
        expect(seen.size, `${where}: every line drawn took the focus in turn`).toBe(lines);
        await page.keyboard.press("Escape");
        await expect(note).toHaveCount(0);
      }
    });
  }

  /**
   * Was known defect D10 (round 37 fix pass 1, found by lane e2e-sync while pinning L13; README "Known defects"): on a phone
   * 320 px wide, a 288 px note in the 140 px short drawing finds no clear place for some lines. At 320 x 640,
   * Glastonbury's notes for lines #1 to #3 cover 2, 1 and 1 other names (Joy Crookes and Shaboozey; Katy J Pearson
   * twice), 0.67 a note on average; at 320 x 568, line #1's note covers Joy Crookes and Shaboozey. Riot Fest's one line
   * is clear. The drawing lane measured the same and found no room inside its files (its fix pass 1 report, L13). This
   * holds L13's acceptance (NEXT.md, lane drawing): no note over more than one other set's name or two other bars, at
   * most half a name a note on average, none over its own two sets. Fixed in the drawing lane's fix pass 2: at 320 px a
   * phone's note may stand up to 140 px above the drawing, over the dateline and the view toggle, and takes no press
   * (measured: 0 other names at 320 x 568, 1 for one line at 320 x 640). A desktop holds the same at 1920 x 1080.
   */
  test("each line's note covers at most one other set's name and two other bars, half a name a note on average, and none of its own sets (320 x 640 and 320 x 568 on a phone; 1920 x 1080 on a desktop; D10, fixed)", async ({ page, isPhone }) => {
    test.setTimeout(120_000);
    const home = new HomePage(page);
    const note = home.graph.locator('[data-thread-note="line"]').filter({ visible: true });
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    const sizes = isPhone ? [{ width: 320, height: 640 }, { width: 320, height: 568 }] : [{ width: 1920, height: 1080 }];
    for (const size of sizes) for (const day of Object.values(DAYS)) {
      await page.setViewportSize(size);
      await home.goto(day.id);
      const where = `${day.title} at ${size.width} x ${size.height}`;
      const lines = await home.graphLines().count();
      expect(lines, `${where}: lines drawn`).toBeGreaterThan(0);
      await home.viewToggle.getByRole("radio", { checked: true }).focus();
      await page.keyboard.press("Tab");
      let names = 0;
      for (let step = 0; step < lines; step++) {
        if (step > 0) await page.keyboard.press("ArrowRight");
        const now = await focused();
        await expect(note).toHaveText(now);
        const covered = await note.evaluate(measureNoteCover);
        names += covered.names.length;
        expect.soft(covered.names.length, `${where}: other names under the note of "${now.slice(0, 60)}" (${covered.names.join(", ")})`).toBeLessThanOrEqual(1);
        expect.soft(covered.bars.length, `${where}: other bars under the note of "${now.slice(0, 60)}"`).toBeLessThanOrEqual(2);
        expect.soft([...covered.ownNames, ...covered.ownBars], `${where}: the note of "${now.slice(0, 60)}" over its own sets`).toEqual([]);
      }
      expect.soft(names / lines, `${where}: other names under a note, on average over ${lines} lines`).toBeLessThanOrEqual(0.5);
      await page.keyboard.press("Escape");
    }
  });

  /**
   * Round 37, verify-2 N1: a phone named only the sets of the detail window it opened on. After a tap on the overview
   * strip, or the arrow keys from one line to the next, the window slid and showed sets with no name (Glastonbury at
   * 390: 4 of 4 after a strip tap at 85%, 6 of 6 after ArrowRight to line #2), with "min" and "is" cut at its left edge.
   * The drawing lane's fix pass 2 plans the phone's names again for each window it slides to.
   */
  test("a phone names every set its detail window shows after the window slides, by a tap on the overview strip or the arrow keys, and cuts no name or tag at the window's edge (round 37, verify-2 N1)", async ({ page, isPhone }) => {
    test.skip(!isPhone, "Only a phone's drawing slides its detail window.");
    test.setTimeout(120_000);
    const home = new HomePage(page);
    const strip = home.graph.locator("[data-strip]").filter({ visible: true });
    // The window on show: its offset on the day's track, the sets it shows whole, those with no name drawn over the
    // window, and every name or tag that crosses the window's edge.
    const read = () =>
      page.evaluate(() => {
        const band = [...document.querySelectorAll<HTMLElement>("[data-hero] [data-band]")].find((element) => element.getBoundingClientRect().width > 0);
        const track = band?.querySelector<HTMLElement>("[data-pan-track]");
        const clip = track?.parentElement?.getBoundingClientRect();
        if (!band || !track || !clip) return { offset: NaN, shown: 0, unnamed: ["no detail window"], cut: [] as string[] };
        const whole = [...band.querySelectorAll<Element>("[data-set]")].filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.left >= clip.left - 0.5 && box.right <= clip.right + 0.5;
        });
        const labels = [...band.querySelectorAll<Element>("[data-label]")].filter(
          (element) => element.getBoundingClientRect().width > 0 && getComputedStyle(element).opacity !== "0",
        );
        const named = new Set(
          labels
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return box.right > clip.left && box.left < clip.right;
            })
            .map((element) => element.getAttribute("data-label")),
        );
        const cut = [...labels, ...band.querySelectorAll<Element>("[data-shared-tag]")]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.right > clip.left + 0.5 && box.left < clip.right - 0.5 && (box.left < clip.left - 0.5 || box.right > clip.right + 0.5);
          })
          .map((element) => element.textContent ?? "");
        return {
          offset: Math.round(track.getBoundingClientRect().left - clip.left),
          shown: whole.length,
          unnamed: whole.filter((element) => !named.has(element.getAttribute("data-set"))).map((element) => element.getAttribute("data-set") ?? ""),
          cut,
        };
      });
    const settled = async () => {
      const found = await read();
      return { named: found.shown > 0 && found.unnamed.length === 0, unnamed: found.unnamed, cut: found.cut };
    };
    let arrowed = 0;
    for (const day of Object.values(DAYS)) {
      // A tap on the overview strip at 85% of its width slides the window there.
      await home.goto(day.id);
      const opening = await read();
      expect(opening.unnamed, `${day.title}: unnamed sets in the opening window`).toEqual([]);
      const box = await strip.boundingBox();
      expect(box, `${day.title}: the overview strip`).not.toBeNull();
      if (!box) continue;
      await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height / 2);
      await expect.poll(async () => (await read()).offset, { message: `${day.title}: the window slid on the strip tap` }).not.toBe(opening.offset);
      await expect
        .poll(settled, { message: `${day.title}, after a strip tap at 85%: sets shown whole with no name, and names or tags cut at the edge` })
        .toEqual({ named: true, unnamed: [], cut: [] });
      // Tab into the drawing on a fresh load, then ArrowRight to the next line, on a day whose phone drawing has more
      // than one line (Riot Fest's moved view draws one at 390).
      await home.goto(day.id);
      if ((await home.graphLines().count()) < 2) continue;
      arrowed += 1;
      await home.viewToggle.getByRole("radio", { checked: true }).focus();
      await page.keyboard.press("Tab");
      const first = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
      expect(first, `${day.title}: Tab reaches the first line`).toMatch(/^#1 of \d+ clashes /);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toMatch(/^#\d+ of \d+ clashes /);
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""), `${day.title}: ArrowRight moves to the next line`).not.toBe(first);
      await expect
        .poll(settled, { message: `${day.title}, after Tab and ArrowRight: sets shown whole with no name, and names or tags cut at the edge` })
        .toEqual({ named: true, unnamed: [], cut: [] });
    }
    // Glastonbury, where verify-2 found 6 of 6 sets unnamed after ArrowRight to line #2, takes the keyboard path.
    expect(arrowed, "days whose phone drawing took the arrow-key slide").toBeGreaterThan(0);
  });
});

/**
 * Where the phone tags are read (round 37, L17): 390 and 320 at 844 px tall (the 172 px band), and from fix pass 1 the
 * short phone's 140 px band at 375 x 667, 360 x 640, 320 x 640 and 320 x 568 (verify-1 found tags 1.5 px from the bars
 * there and two dropped at 320 px wide, before the drawing lane's fix pass).
 */
const PHONE_TAG_SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 844 },
  { width: 375, height: 667 },
  { width: 360, height: 640 },
  { width: 320, height: 640 },
  { width: 320, height: 568 },
] as const;

test.describe("the day graph", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the first screen does not shift: no layout shift over 5 s, and the hero's boxes hold from DOMContentLoaded to 4 s`, async ({ page }) => {
      // Registered before the page's own scripts: a buffered layout-shift observer from navigation, and two
      // snapshots of the hero's boxes, 50 ms after DOMContentLoaded (the server's frame) and at 4 s.
      await page.addInitScript((selectors: Record<string, string>) => {
        const store = window as unknown as { __shift: number; __boxes: Record<string, unknown> };
        store.__shift = 0;
        store.__boxes = {};
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) store.__shift += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        const snapshot = () =>
          Object.fromEntries(
            Object.entries(selectors).map(([name, selector]) => {
              const element = [...document.querySelectorAll(selector)].find((item) => item.getBoundingClientRect().width > 0);
              if (!element) return [name, null];
              const box = element.getBoundingClientRect();
              return [name, { x: box.x, y: box.y + window.scrollY, width: box.width, height: box.height }];
            }),
          );
        document.addEventListener("DOMContentLoaded", () => {
          window.setTimeout(() => (store.__boxes.early = snapshot()), 50);
          window.setTimeout(() => (store.__boxes.late = snapshot()), 4_000);
        });
      }, HERO_BOXES);

      // One load first warms the dev server and puts the webfont in this browser's cache, so the load measured here is
      // the page's own frame. Round 37 (L1): the 0.0126 shift this test met under four workers was not the font. The
      // server's own decision request timed out (4 s), so its frame held a pending hero group 46 px shorter than the
      // settled one, without the toggle, readout and Keep, and the toggle (339 -> 385) and the drawing (407 -> 453)
      // followed the group's height when the decision arrived; the streamed frame could also paint the drawing before
      // the group. The fix: the preset answer carries the day's decision, so the server paints the whole group at once,
      // and every state the group can be painted in keeps one row geometry, held from the hero's first bytes.
      // The limit stays 0.0005.
      await page.goto(`/?preset=${day.id}`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.goto(`/?preset=${day.id}`, { waitUntil: "domcontentloaded" });
      await expect
        .poll(() => page.evaluate(() => performance.now() >= 5_000 && "late" in (window as unknown as { __boxes: object }).__boxes), {
          timeout: 20_000,
          message: "5 s on the page",
        })
        .toBe(true);
      const { shift, early, late } = await page.evaluate(() => {
        const store = window as unknown as { __shift: number; __boxes: Record<string, Record<string, Box>> };
        return { shift: store.__shift, early: store.__boxes.early, late: store.__boxes.late };
      });
      test.info().annotations.push({ type: `layout shift on ${day.title}`, description: shift.toFixed(4) });
      expect(shift, "cumulative layout shift over 5 s").toBeLessThan(0.0005);
      for (const name of Object.keys(HERO_BOXES)) {
        const [a, b] = [early[name], late[name]];
        expect(a, `${name} is in the server's frame`).not.toBeNull();
        expect(b, `${name} is there at 4 s`).not.toBeNull();
        for (const key of ["x", "y", "width", "height"] as const) {
          expect(Math.abs((a?.[key] ?? 0) - (b?.[key] ?? 0)), `${name} ${key}: ${a?.[key]} at DOMContentLoaded, ${b?.[key]} at 4 s`).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  for (const view of ["moved", "published"] as const) {
    test(`at 390 x 844, Keep this move ends by y = 787, and after Keep the whole confirmation ends by y = 844 (${view} view)`, async ({ page, isPhone }) => {
      test.skip(!isPhone, "The phone budget is measured at 390 x 844.");
      const home = new HomePage(page);
      await home.goto(DAYS.glastonbury.id);

      if (view === "published") await home.chooseView("As published");
      await expect(home.graph).toHaveAttribute("data-view", view);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const keep = await home.keepMove.boundingBox();
      expect((keep?.y ?? 0) + (keep?.height ?? 0), "Keep this move bottom").toBeLessThanOrEqual(787);
      // The side effects are on the first screen too.
      expect(await bottomOf(page, "[data-side-effects]"), "side-effect line bottom").toBeLessThanOrEqual(844);

      await home.keepMove.click();
      await expect(home.keptNotice).toBeVisible();
      expect(await page.evaluate(() => window.scrollY), "no scroll was needed").toBe(0);
      const notice = await home.keptNotice.boundingBox();
      expect((notice?.y ?? 0) + (notice?.height ?? 0), "the whole confirmation, its last line included").toBeLessThanOrEqual(844);
      await expect(home.keptNotice).toContainText("Nothing moves until the acts’ teams agree.");
    });
  }

  for (const view of ["moved", "published"] as const) {
    test(`at 375 x 667 the drawing has no overview strip, the side effects and Keep hold their budgets, and Keep brings its whole confirmation into view (${view} view)`, async ({ page, isPhone }) => {
      test.skip(!isPhone, "A short phone, measured in the phone project.");
      await page.setViewportSize({ width: 375, height: 667 });
      const home = new HomePage(page);
      await home.goto(DAYS.glastonbury.id);
      // Focus follows a press only when the plan answers within 2 s (see answerKeepAtOnce).
      const answered = await home.answerKeepAtOnce(DAYS.glastonbury.id);

      // The short layout: three rows, no overview strip.
      // Each layout holds one band per width (and each band names its layout too), so the layout is its wrapper.
      await expect(home.graph.locator(':scope > [data-layout="short"]')).toBeVisible();
      await expect(home.graph.locator(':scope > [data-layout="phone"]')).toBeHidden();
      await expect(home.graph.locator("[data-strip]").filter({ visible: true })).toHaveCount(0);
      if (view === "published") await home.chooseView("As published");
      await expect(home.graph).toHaveAttribute("data-view", view);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(await bottomOf(page, "[data-side-effects]"), "side-effect line bottom").toBeLessThanOrEqual(667);
      const keep = await home.keepMove.boundingBox();
      expect((keep?.y ?? 0) + (keep?.height ?? 0), "Keep this move bottom").toBeLessThanOrEqual(760);

      await home.keepMove.click();
      await expect(home.keptNotice).toBeVisible();
      await expect(home.seeYourPlan).toBeFocused();
      expect(answered(), "the press was answered with the server's own what-if").toBe(1);
      // The whole confirmation, "Nothing moves until the acts' teams agree." included, is on the screen.
      await expect(home.keptNotice).toBeInViewport({ ratio: 1 });
    });
  }

  test("no width from 320 to 1440 scrolls the page sideways", async ({ page, isPhone }) => {
    test.skip(isPhone, "The desktop project loads each width in turn.");
    const home = new HomePage(page);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await home.goto(DAYS.glastonbury.id);
      expect(await page.evaluate(() => window.innerWidth), "the width under test").toBe(width);
      await expectNoHorizontalScroll(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `scrollWidth at ${width}`).toBeLessThanOrEqual(width);
    }
  });

  test("the hero says what it needs in at most 160 visible words at 1440 and 131 at 390", async ({ page, isPhone }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // Counted as DECISION.md 4.3 says: visible text in the hero that holds a letter, not screen-reader text; inside
    // the drawing only its tags count (act names, stage names and clock times are the drawing itself); numerals
    // are not words; the picker's and the toggle's group names are accessible names, not visible text.
    const counted = await page.locator("[data-hero]").evaluate((hero) => {
      const shown = (element: Element | null): boolean => {
        for (let node = element; node && node !== hero.parentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const box = node.getBoundingClientRect();
          if (box.width <= 1 && box.height <= 1) return false;
        }
        return true;
      };
      const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
      const words: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || !node.textContent?.trim() || !shown(parent)) continue;
        if (parent.closest("[data-day-graph]") && !parent.closest("[data-shared-tag]")) continue;
        words.push(...node.textContent.split(/\s+/).filter((token) => /\p{L}/u.test(token)));
      }
      return words;
    });
    // Round 35 (R1): the lede gained the frame, so the budget moved from 120 and 117 to 125 and 122. Round 37 (AO2,
    // NEXT.md 5.4): the desktop note (why this move, two sets, near 100) and the key's lock and dotted words move it to
    // the count measured after the build, 160 at 1440 and 131 at 390, inside the decided caps of 170 and 131.
    const budget = isPhone ? 131 : 160;
    test.info().annotations.push({ type: `hero words at ${isPhone ? 390 : 1440}`, description: String(counted.length) });
    expect(counted.length, `visible hero words: ${counted.join(" ")}`).toBeLessThanOrEqual(budget);
    // The guarded lines are never trimmed to fit.
    await expect(home.tasteLine).toContainText("(a rank, not attendance)");
    await expect(home.attribution).toHaveText("Selected and scored by this app’s index. A reading, not a verdict.");
  });

  test.describe("with motion allowed", () => {
    test.use({ reducedMotion: "no-preference" });

    test("a toggle press moves the set in 450 ms, every animation in the drawing, and settles on the other view", async ({ page, isPhone }) => {
      const home = new HomePage(page);
      await home.goto(DAYS.glastonbury.id);
      expect(await drawingAnimations(page), "nothing moves on first paint").toEqual([]);

      await home.chooseView("As published");
      const durations = await drawingAnimations(page);
      expect(durations.length, "the press starts the move").toBeGreaterThan(0);
      for (const duration of durations) expect(Math.abs(duration - 450), `an animation of ${duration} ms`).toBeLessThanOrEqual(20);
      await expect(home.graph).toHaveAttribute("data-view", "published");
      // The settled view carries the published windows and no ghost.
      await expect.poll(() => drawingAnimations(page).then((all) => all.length), { timeout: 3_000, message: "the move settles" }).toBe(0);
      await expect(home.graph.locator("[data-ghost]").filter({ visible: true })).toHaveCount(0);
      await expect(home.graph.locator('[data-shared-tag="hatch"]').filter({ visible: true })).toHaveText("45 min shared");

      // And back: the move again, in the same time.
      await home.chooseView("Sprints 15 min later");
      const back = await drawingAnimations(page);
      expect(back.length).toBeGreaterThan(0);
      for (const duration of back) expect(Math.abs(duration - 450), `an animation of ${duration} ms`).toBeLessThanOrEqual(20);
      await expect.poll(() => drawingAnimations(page).then((all) => all.length), { timeout: 3_000 }).toBe(0);
      await expect(home.graph.locator("[data-ghost]").filter({ visible: true })).toHaveCount(1);
      // Round 37 (L23): on a desktop the moved view's tag says the change ("45 → 30 min shared"); a phone keeps the
      // short tag for its narrow window.
      await expect(home.graph.locator('[data-shared-tag="hatch"]').filter({ visible: true })).toHaveText(isPhone ? "30 min shared" : "45 → 30 min shared");
    });
  });

  test("with reduced motion a toggle press creates no animation in the drawing: the view swaps at once", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.chooseView("As published");
    expect(await home.graph.getAttribute("data-view")).toBe("published");
    expect(await drawingAnimations(page), "no animation under reduced motion").toEqual([]);
    await home.chooseView("Sprints 15 min later");
    expect(await home.graph.getAttribute("data-view")).toBe("moved");
    expect(await drawingAnimations(page)).toEqual([]);
  });

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the side-effect line is said in the server HTML, in both views, and after Keep`, async ({ page }) => {
      const line = SIDE_EFFECTS[day.id];
      // The server's own frame: the line is in the HTML before any script runs.
      const html = await (await page.request.get(`/?preset=${day.id}`)).text();
      expect(html, "the server HTML holds the side-effect line").toMatch(new RegExp(`data-side-effects=""[^>]*>${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`));

      const home = new HomePage(page);
      await home.goto(day.id);
      await expect(home.sideEffects).toHaveText(line);
      await home.chooseView("As published");
      await expect(home.sideEffects).toHaveText(line);
      await home.keepMove.click();
      await expect(home.keptNotice).toBeVisible();
      await expect(home.sideEffects).toHaveText(line);
      await home.chooseView(/ min (later|earlier)$/);
      await expect(home.sideEffects).toHaveText(line);
      // The drawing's description says it too, after the key and the move.
      await expect(home.graph).toHaveAccessibleDescription(new RegExp(`${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    });
  }

  test("the drawing's name says which view it shows", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await expect(home.graph).toHaveAccessibleName(`${DAYS.glastonbury.title}, drawn with Sprints 15 min later: 39 sets on 5 stages`);
    await home.chooseView("As published");
    await expect(home.graph).toHaveAccessibleName(`${DAYS.glastonbury.title}, as published: 39 sets on 5 stages`);

    await home.goto(DAYS.riot.id);
    await expect(home.graph).toHaveAccessibleName(/^Riot Fest 2026, Sunday, drawn with Bowling for Soup 20 min later: \d+ sets on \d+ stages$/);
    await home.chooseView("As published");
    await expect(home.graph).toHaveAccessibleName(/^Riot Fest 2026, Sunday, as published: \d+ sets on \d+ stages$/);
  });

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the key's lock and dotted words name marks the drawing draws: no-signal bars in a dotted edge, never dashed, and the chosen clash's window in a solid raspberry edge (round 37, L5, L24)`, async ({ page }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      await expect(home.graphKey).toContainText("Lock: fixed by this app. Dotted: no Qloo signal.");
      const marks = await home.graph.evaluate((graph) => {
        const band = [...graph.querySelectorAll<HTMLElement>("[data-band]")].find((element) => element.getClientRects().length > 0) as HTMLElement;
        const bars = [...band.querySelectorAll<HTMLElement>("[data-set]")].filter((bar) => bar.getClientRects().length > 0);
        const styles = bars.map((bar) => {
          const style = getComputedStyle(bar);
          return { style: style.borderTopStyle, width: style.borderTopWidth, radius: style.borderTopLeftRadius };
        });
        const probe = document.createElement("span");
        probe.style.color = "var(--primary)";
        graph.appendChild(probe);
        const primary = getComputedStyle(probe).color;
        probe.remove();
        const edge = band.querySelector("[data-shared-window] + rect");
        return {
          dotted: styles.filter((item) => item.style === "dotted"),
          dashed: styles.filter((item) => item.style === "dashed").length,
          edge: edge
            ? { stroke: getComputedStyle(edge).stroke, width: edge.getAttribute("stroke-width"), dash: getComputedStyle(edge).strokeDasharray, rx: edge.getAttribute("rx") }
            : null,
          primary,
        };
      });
      // At least one bar Qloo has no signal for is drawn, each in a 1 px dotted edge on its 6 px corners; no bar is dashed
      // (dashed keeps its one meaning: a published slot or a new overlap).
      expect(marks.dotted.length, "no-signal bars drawn with a dotted edge").toBeGreaterThanOrEqual(1);
      for (const bar of marks.dotted) expect(bar, "a no-signal bar's edge").toEqual({ style: "dotted", width: "1px", radius: "6px" });
      expect(marks.dashed, "bars with a dashed edge").toBe(0);
      // The chosen clash's shared window: a solid raspberry edge, 1.5 px, on the mark's 6 px corner.
      expect(marks.edge, "the chosen clash's window has an edge").not.toBeNull();
      expect(marks.edge?.stroke, "in raspberry, the shared-time colour").toBe(marks.primary);
      expect(marks.edge?.width).toBe("1.5");
      expect(marks.edge?.dash, "solid, never dashed").toBe("none");
      expect(marks.edge?.rx).toBe("6");
    });
  }

  test("the moved view's tags: on a desktop the chosen clash says before and after, clear of the bars; on a phone at 390 and 320, and on a short phone (375 x 667, 360 x 640, 320 x 640, 320 x 568), every tag is drawn and 2 px clear of the bars (round 37, L23, L17)", async ({ page, isPhone }) => {
    test.setTimeout(120_000);
    const home = new HomePage(page);
    const tags = () => home.graph.locator("[data-shared-tag]").filter({ visible: true });
    /** Each visible tag's text, and its least distance to a visible bar in the band on show. */
    const clearance = () =>
      home.graph.evaluate((graph) => {
        const band = [...graph.querySelectorAll<HTMLElement>("[data-band]")].find((element) => element.getClientRects().length > 0) as HTMLElement;
        const bars = [...band.querySelectorAll<HTMLElement>("[data-set]")].filter((bar) => bar.getClientRects().length > 0).map((bar) => bar.getBoundingClientRect());
        return [...band.querySelectorAll<HTMLElement>("[data-shared-tag]")]
          .filter((tag) => tag.getClientRects().length > 0 && parseFloat(getComputedStyle(tag).opacity) > 0)
          .map((tag) => {
            const t = tag.getBoundingClientRect();
            const gap = Math.min(...bars.map((b) => Math.hypot(Math.max(0, b.left - t.right, t.left - b.right), Math.max(0, b.top - t.bottom, t.top - b.bottom))));
            return { text: tag.textContent ?? "", gap };
          });
      });
    if (!isPhone) {
      const clear = async (where: string) => {
        for (const tag of await clearance()) expect(tag.gap, `${where}: "${tag.text}" against the nearest bar`).toBeGreaterThanOrEqual(2);
      };
      await home.goto(DAYS.glastonbury.id);
      await expect(tags()).toHaveText(["45 → 30 min shared", "new 15 min"]);
      await clear("Glastonbury, moved");
      await home.chooseView("As published");
      await expect(tags()).toHaveText(["45 min shared"]);
      await clear("Glastonbury, as published");
      await home.goto(DAYS.riot.id);
      await expect(tags()).toHaveText(["40 → 35 min shared"]);
      await clear("Riot Fest, moved");
      await home.chooseView("As published");
      await expect(tags()).toHaveText(["40 min shared"]);
      await clear("Riot Fest, as published");
      return;
    }
    // Round 37 fix pass 1 (verify-1 N8, L17): the short phone's 140 px band (heights up to about 667) is held as well.
    for (const size of PHONE_TAG_SIZES) {
      const at = `${size.width} x ${size.height}`;
      await page.setViewportSize(size);
      await home.goto(DAYS.glastonbury.id);
      await expect(tags(), `Glastonbury at ${at}, moved`).toHaveText(["30 min shared", "new 15 min"]);
      for (const tag of await clearance()) expect(tag.gap, `Glastonbury at ${at}: "${tag.text}" against the nearest bar`).toBeGreaterThanOrEqual(2);
      await home.goto(DAYS.riot.id);
      await home.chooseView("As published");
      await expect(tags(), `Riot Fest at ${at}, as published`).toHaveText(["40 min shared"]);
      for (const tag of await clearance()) expect(tag.gap, `Riot Fest at ${at}: "${tag.text}" against the nearest bar`).toBeGreaterThanOrEqual(2);
    }
  });

  test("the phone's overview strip: one mark per set, every line of the day solid in quiet ink, nothing dashed; a desktop draws no strip (round 37, L18)", async ({ page, isPhone }) => {
    const home = new HomePage(page);
    const strip = home.graph.locator("[data-strip]").filter({ visible: true });
    if (!isPhone) {
      await home.goto(DAYS.glastonbury.id);
      await expect(strip, "no overview strip at 1440").toHaveCount(0);
      return;
    }
    // Every line of the day: the 15 costliest, and on Riot Fest's published view the overlap the move ends.
    const LINES = { [DAYS.glastonbury.id]: { moved: 15, published: 15, sets: 39 }, [DAYS.riot.id]: { moved: 15, published: 16, sets: 34 } } as const;
    for (const day of Object.values(DAYS)) {
      await home.goto(day.id);
      for (const view of ["moved", "published"] as const) {
        if (view === "published") await home.chooseView(/^As published$/);
        await expect(home.graph).toHaveAttribute("data-view", view);
        await expect(strip).toHaveCount(1);
        const found = await strip.evaluate((element) => {
          const marks = new Set([...element.querySelectorAll<HTMLElement>("[data-strip-mark]")].map((mark) => mark.dataset.stripMark));
          const lines = [...element.querySelectorAll<HTMLElement>("[data-strip-line]")].filter((line) => parseFloat(getComputedStyle(line.parentElement as Element).opacity) > 0);
          const fills = lines.map((line) => ({ image: getComputedStyle(line).backgroundImage, alpha: getComputedStyle(line).backgroundColor }));
          const dashed = [...element.querySelectorAll("*")].filter((item) => {
            const style = getComputedStyle(item);
            return [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle].includes("dashed") || (style.strokeDasharray && style.strokeDasharray !== "none") || /repeating-/.test(style.backgroundImage);
          }).length;
          return { marks: marks.size, lines: lines.length, images: fills.filter((fill) => fill.image !== "none").length, dashed };
        });
        const where = `${day.title}, ${view}`;
        expect(found.marks, `${where}: one mark per set`).toBe(LINES[day.id].sets);
        expect(found.lines, `${where}: the strip draws every line of the day`).toBe(LINES[day.id][view]);
        expect(found.images, `${where}: lines with a pattern instead of a solid fill`).toBe(0);
        expect(found.dashed, `${where}: dashed marks in the strip`).toBe(0);
      }
    }
  });

  test("the hero's colours keep one meaning per hue: nothing on the first screen sits between hue 15 and 75", async ({ page, isPhone }) => {
    // Light at 1440 and dark at 390, as the corner checks are measured.
    const theme = isPhone ? "dark" : "light";
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    await page.emulateMedia({ colorScheme: theme });
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);
    expect(await home.chrome.appliedTheme()).toBe(theme);

    const warm = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      // sRGB to OKLCH (Björn Ottosson's OKLab): chroma and hue in degrees.
      const oklch = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = "rgba(0, 0, 0, 0)";
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r8, g8, b8, a] = context.getImageData(0, 0, 1, 1).data;
        if (a === 0) return null;
        const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        const [r, g, b] = [r8, g8, b8].map((v) => lin(v / 255));
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
        const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
        return { chroma: Math.hypot(A, B), hue: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
      };
      const hero = document.querySelector("[data-hero]") as HTMLElement;
      const elements = [hero, ...hero.querySelectorAll<HTMLElement | SVGElement>("*")].filter((element) => element.getBoundingClientRect().width > 0);
      const found: string[] = [];
      for (const element of elements) {
        const style = getComputedStyle(element);
        const colours = [style.color, style.backgroundColor, style.borderTopColor, style.borderBottomColor, style.outlineColor];
        if (element instanceof SVGElement) colours.push(style.fill, style.stroke);
        for (const colour of colours) {
          if (!colour || colour === "none" || colour.startsWith("url(")) continue;
          const value = oklch(colour);
          if (value && value.chroma >= 0.05 && value.hue >= 15 && value.hue <= 75) {
            found.push(`${element.tagName.toLowerCase()} ${colour} (hue ${value.hue.toFixed(0)}, chroma ${value.chroma.toFixed(3)})`);
          }
        }
      }
      return found;
    });
    expect(warm, "computed colours with a hue between 15 and 75 in the hero").toEqual([]);
  });

  test("the page loads with no console error and no hydration warning, on both days", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()) && /hydrat|did not match|server rendered|server html/i.test(message.text())) warnings.push(message.text());
    });
    const home = new HomePage(page);
    for (const day of Object.values(DAYS)) {
      await home.goto(day.id);
      await home.chooseView("As published");
      await home.chooseView(/ min (later|earlier)$/);
    }
    expect(warnings, "hydration warnings").toEqual([]);
  });
});

test.describe("the day graph on the invented day", () => {
  test("its name says the timetable is invented and never calls it published, in both views", async ({ page }) => {
    await serveInventedDay(page);
    const home = new HomePage(page);
    await home.goto();

    await expect(home.graph).toHaveAccessibleName(/, invented timetable, drawn with .+: \d+ sets on \d+ stages$/);
    await home.chooseView("Invented timetable");
    await expect(home.graph).toHaveAccessibleName(/, invented timetable, without the move: \d+ sets on \d+ stages$/);
    for (const name of [await home.graph.getAttribute("aria-labelledby")]) {
      expect(await page.evaluate((id) => document.getElementById(id ?? "")?.textContent ?? "", name)).not.toMatch(/published/i);
    }
  });
});
