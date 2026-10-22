"use client";

import { Lock } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  drawingHeight,
  drawingTitle,
  EASE_MOVE,
  EASE_OUT,
  keyLine,
  LAYOUT,
  lockWords,
  PAN_MS,
  planLeaders,
  setNote,
  settledAnnouncement,
  sideEffectText,
  TAG_MS,
  threadNote,
  type DayGraphModel,
  type DayGraphSet,
  type DayGraphThread,
  type DrawingLayout,
  type GraphView,
  type Leader,
  type Span,
  type ViewLeaders,
} from "@/lib/day-graph";
import {
  BANDS,
  barTopOf,
  CASING,
  DETAIL_TOP,
  detailAt,
  edgeTransform,
  flightKeyframes,
  GUTTER,
  LABEL_LINE,
  lineColor,
  lineKeyAction,
  lineTransform,
  MARK_RADIUS,
  moverAt,
  moverTransform,
  movingLineAt,
  NOTE_GAP,
  NOTE_REACH,
  notePlace,
  pct,
  placeNote,
  planDrawing,
  retarget,
  spotBox,
  textWidth,
  trackOf,
  trackPct,
  viewP,
  washTransform,
  windowAt,
  type LayoutPlan,
  type NoteBox,
  type PlanBar,
  type PlanLine,
  type PlanWindow,
  type Spot,
} from "@/lib/day-graph-motion";
import { formatClock } from "@/lib/timetable";
import { cn } from "@/lib/utils";

/** The three layouts, each in the markup and picked by CSS alone, so the server frame needs no measuring. */
const LAYOUTS: readonly DrawingLayout[] = ["desktop", "phone", "short"];
const LAYOUT_CLASS: Record<DrawingLayout, string> = {
  desktop: "relative hidden lg:block",
  phone: "relative lg:hidden [@media(max-height:699px)]:hidden",
  short: "relative hidden max-lg:[@media(max-height:699px)]:block",
};
/**
 * Inside each layout, one drawing per band of screen widths (`BANDS`), each placed at its band's narrowest track
 * and shown by CSS alone, so nothing is placed again after hydration and nothing shifts.
 */
const BAND_CLASS: Record<number, string> = {
  848: "hidden lg:max-[1120px]:block",
  944: "hidden min-[1120px]:max-xl:block",
  1104: "hidden xl:block",
  224: "block min-[360px]:hidden",
  264: "hidden min-[360px]:max-[390px]:block",
  294: "hidden min-[390px]:block",
};

/**
 * A move in flight to the displacement the asked-for view draws, from the resting view `from`; `fromP` is
 * null when it takes over from a running flight, whose place is read off the screen.
 */
type Flight = { id: number; from: GraphView; fromP: number | null; toP: number; target: GraphView };
type Settled = { id: number; view: GraphView };
/** The tags and names swapped when the drawing settles on a view whose labels differ. */
type Swap = { id: number; from: GraphView; to: GraphView };
type Note = { kind: "line"; key: string } | { kind: "set"; id: string };

/** The marks a phone's slide names afresh: names, tags and leaders. */
const PAN_NAMES = "[data-label], [data-shared-tag], [data-leader]";
/** What identifies one of `PAN_NAMES` on screen: which name it is, its words and where it sits. */
function nameSig(element: Element): string {
  return [
    element.getAttribute("data-label") ?? "",
    element.getAttribute("data-shared-tag") ?? "",
    element.getAttribute("data-leader") ?? "",
    element.textContent ?? "",
    element.getAttribute("style") ?? "",
    ...["x1", "y1", "x2", "y2"].map((name) => element.querySelector("line")?.getAttribute(name) ?? ""),
  ].join("|");
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The room on screen above and below the drawing that a line's note may reach into (px), the boxes of what the page
 * shows in the room above the drawing (px from the drawing's top left corner) and the drawing's width when they were
 * measured.
 */
type Reach = { top: number; bottom: number; keep: readonly NoteBox[]; width: number };
/** Before anything is measured: the full reach, nothing known above, no width. */
const OPEN_REACH: Reach = { top: NOTE_REACH.top, bottom: NOTE_REACH.bottom, keep: [], width: 0 };
/**
 * How far a phone's line note may reach under the drawing (px): its narrow drawing has no room inside that keeps clear
 * of the names, so the note sits under it, over the decision there, until it closes.
 */
const PHONE_NOTE_BELOW = 140;
/**
 * How far a phone's line note may reach above the drawing (px): a screen too short to hold it under the drawing (a
 * 320px phone) lets it cover the lines above the drawing, the dateline and the view toggle, until it closes, rather
 * than the drawing's own names. What it covers there takes no press while it shows (it lets every press through).
 */
const PHONE_NOTE_ABOVE = 140;

/**
 * What the page shows in the `room` px above the drawing `root` (text, controls, figures and any painted box), as
 * boxes in px from the drawing's top left corner, so a note reaching above the drawing never covers them. Read from
 * the nearest box that holds that room; hidden and screen-reader-only elements are left out.
 */
function shownAbove(root: HTMLElement, room: number): NoteBox[] {
  const box = root.getBoundingClientRect();
  let scope: HTMLElement = root;
  while (scope.parentElement && scope.getBoundingClientRect().top > box.top - room) scope = scope.parentElement;
  const out: NoteBox[] = [];
  for (const element of scope.querySelectorAll<Element>("*")) {
    if (root.contains(element) || element.contains(root)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1 || rect.bottom <= box.top - room || rect.top >= box.top || rect.right <= box.left || rect.left >= box.right) continue;
    if (!paints(element)) continue;
    out.push({ x0: rect.left - box.left, x1: rect.right - box.left, y0: rect.top - box.top, y1: rect.bottom - box.top });
  }
  return out;
}

/** Whether an element draws anything: text of its own, a control or figure, or a filled or bordered box. */
function paints(element: Element): boolean {
  const seen = { checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true };
  if (typeof element.checkVisibility === "function" && !element.checkVisibility(seen)) return false;
  if (element instanceof SVGElement || /^(BUTTON|INPUT|SELECT|TEXTAREA|IMG|VIDEO|CANVAS|A|LABEL)$/.test(element.tagName)) return true;
  if ([...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "")) return true;
  const style = getComputedStyle(element);
  const filled = style.backgroundColor !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(style.backgroundColor);
  return filled || ["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none");
}

function sameBoxes(a: readonly NoteBox[], b: readonly NoteBox[]): boolean {
  return a.length === b.length && a.every((item, i) => item.x0 === b[i].x0 && item.x1 === b[i].x1 && item.y0 === b[i].y0 && item.y1 === b[i].y1);
}

/** The band drawing the visitor sees (every other one is display: none). */
function visibleBand(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  for (const element of root.querySelectorAll<HTMLElement>("[data-band]")) if (element.getClientRects().length > 0) return element;
  return null;
}

function cancelAll(list: { current: Animation[] }) {
  for (const animation of list.current) animation.cancel();
  list.current = [];
}

const spanPct = (track: Span, span: Span) => pct(((span.end - span.start) / Math.max(1, track.end - track.start)) * 100);

/** What identifies a label on screen, so the drawing swaps only those that change between views. */
function spotSignature(spot: Spot, anchor: number): string {
  return [spot.lines.join("/"), spot.kind, Math.round(anchor * 100), spot.dx, spot.top, spot.align].join("|");
}

/** Where a line stands at displacement `p`: a line that follows the mover keeps its share of the way across its window. */
function lineMid(model: DayGraphModel, line: PlanLine, other: PlanLine | undefined, p: number, published: boolean): number {
  const move = model.move;
  if (!move || !line.moving) return line.mid;
  const otherId = line.thread.aId === move.actId ? line.thread.bId : line.thread.aId;
  const set = model.sets.find((item) => item.actId === otherId);
  if (!set) return line.mid;
  const fracPub = published ? line.frac : (other?.frac ?? line.frac);
  const fracMoved = published ? (other?.frac ?? line.frac) : line.frac;
  return movingLineAt(move, { start: set.start, end: set.end }, p, fracPub, fracMoved);
}

/**
 * The hero's drawing of one festival day: every set on its stage row with its name, the day's ranked clashes as
 * straight lines between the two sets of each (thicker for a higher taste overlap rank), and the decision's move
 * with its published slot dashed, the chosen clash's shared minutes hatched and every overlap the move starts
 * drawn dashed. The server renders the final frame of `view`; changing `view` moves the set in 450ms, every
 * window and line that touches it following the same displacement, and announces the result once when it settles.
 */
export function DayGraph(props: {
  model: DayGraphModel;
  view: GraphView;
  onSettled?: (view: GraphView) => void;
  className?: string;
  /**
   * One layout drawn whatever the screen: only its markup, placed at its narrowest band and shown with no viewport
   * class (every element id already comes from this instance's `useId`, so two drawings on a page never share one).
   * Left out, the drawing picks its layout and band by CSS, as the hero's does.
   */
  layout?: DrawingLayout;
}) {
  const { model, view, onSettled, className, layout: forced } = props;
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  // Where the phone's detail window starts (minutes): the opening window, until a line or a tap on the strip slides it.
  const [pan, setPan] = useState(model.focus.start);
  // One plan per band of each layout; a short phone has its own, with thinner bars and rows and no strip. A forced
  // layout plans only its narrowest band. A phone's plans are placed for the detail window it shows, and again each
  // time it slides, so every set it shows is named; the server frame and the first paint place the opening window.
  const layouts: readonly DrawingLayout[] = forced ? [forced] : LAYOUTS;
  const bandsOf = useCallback(
    (layout: DrawingLayout) => (forced ? (layout === forced ? [BANDS[layout][0]] : []) : BANDS[layout]),
    [forced],
  );
  const desktopPlans = useMemo(() => bandsOf("desktop").map((band) => planDrawing(model, "desktop", band.track)), [model, bandsOf]);
  const phonePlans = useMemo(() => {
    const detail = detailAt(model, pan);
    return (["phone", "short"] as const).map((layout) => bandsOf(layout).map((band) => planDrawing(model, layout, band.track, detail)));
  }, [model, bandsOf, pan]);
  const plans = useMemo(
    () => ({ desktop: desktopPlans, phone: phonePlans[0], short: phonePlans[1] }) as Record<DrawingLayout, LayoutPlan[]>,
    [desktopPlans, phonePlans],
  );
  const planOf = useCallback(
    (band: HTMLElement | null): LayoutPlan | null => {
      if (!band) return null;
      const layout = band.dataset.layout as DrawingLayout | undefined;
      const track = Number(band.dataset.band);
      return (layout && plans[layout]?.find((plan) => plan.reference === track)) ?? null;
    },
    [plans],
  );
  // Each band's leaders, from its plan: placed once with the names, so the server frame draws them too.
  const desktopLeaders = useMemo(() => desktopPlans.map((plan) => planLeaders(model, plan)), [model, desktopPlans]);
  const phoneLeaders = useMemo(() => phonePlans.map((list) => list.map((plan) => planLeaders(model, plan))), [model, phonePlans]);
  const leaders = useMemo(
    () => ({ desktop: desktopLeaders, phone: phoneLeaders[0], short: phoneLeaders[1] }) as Record<DrawingLayout, Record<GraphView, ViewLeaders>[]>,
    [desktopLeaders, phoneLeaders],
  );
  const lockTitle = useMemo(() => lockWords(model), [model]);
  const modelKey = [model.presetId, model.day, model.synthetic, model.builtAt, model.move?.label ?? "", model.sets.length, model.threads.length].join("|");

  const [seen, setSeen] = useState(modelKey);
  const [drawn, setDrawn] = useState<GraphView>(view);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [swap, setSwap] = useState<Swap | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [announce, setAnnounce] = useState("");
  const [count, setCount] = useState(0);
  const [pin, setPin] = useState<Note | null>(null);
  const [hover, setHover] = useState<Note | null>(null);
  const [keyed, setKeyed] = useState<Note | null>(null);
  const [active, setActive] = useState<string | null>(null);
  // How far a line's note may reach past the drawing's top and foot: `NOTE_REACH`, or less where the window ends sooner,
  // and what the page shows in the room above the drawing, which a note reaching there keeps clear of.
  const [reach, setReach] = useState<Reach>(OPEN_REACH);
  if (seen !== modelKey) {
    // Another day: one state value per day, drawn at once from the new model with nothing carried over,
    // and no announcement left pending.
    setSeen(modelKey);
    setDrawn(view);
    setFlight(null);
    setSwap(null);
    setSettled(null);
    setAnnounce("");
    setPin(null);
    setHover(null);
    setKeyed(null);
    setActive(null);
    setPan(model.focus.start);
  } else if (view !== (flight ? flight.target : drawn)) {
    // A new view: a flight from where the drawing is (read from the screen when one is already running), or
    // at once when there is no move or motion is unwelcome (no animation is ever created then).
    const id = count + 1;
    setCount(id);
    if (!model.move || prefersReducedMotion()) {
      setFlight(null);
      setDrawn(view);
      setSwap(null);
      setAnnounce("");
      setSettled({ id, view });
    } else {
      setFlight({ id, from: flight ? flight.from : drawn, fromP: flight ? null : viewP(model, drawn), toP: viewP(model, view), target: view });
    }
  }

  const flightAnims = useRef<Animation[]>([]);
  const swapAnims = useRef<Animation[]>([]);
  const panAnims = useRef<Animation[]>([]);
  const panFrom = useRef<[HTMLElement, string][] | null>(null);
  /** The names, tags and leaders the band drew before a slide, so only the ones the new window adds fade in. */
  const panNames = useRef<Set<string> | null>(null);
  const running = useRef<{ fromP: number; toP: number } | null>(null);
  const latest = useRef({ model, onSettled });
  useLayoutEffect(() => {
    latest.current = { model, onSettled };
  });

  // A day change cancels every animation.
  useLayoutEffect(
    () => () => {
      cancelAll(flightAnims);
      cancelAll(swapAnims);
      cancelAll(panAnims);
    },
    [modelKey],
  );

  const settle = useCallback((done: Flight) => {
    setFlight(null);
    setDrawn(done.target);
    setSwap(done.from !== done.target && !prefersReducedMotion() ? { id: done.id, from: done.from, to: done.target } : null);
    setAnnounce("");
    setSettled({ id: done.id, view: done.target });
  }, []);

  // Each settle is announced once, politely, then reported; never on first paint.
  useEffect(() => {
    if (!settled) return;
    const timer = window.setTimeout(() => {
      setAnnounce(settledAnnouncement(latest.current.model, settled.view));
      latest.current.onSettled?.(settled.view);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [settled]);

  /** Where the move is now: read from the mover's computed transform, so a retarget starts exactly there. */
  const currentP = useCallback((): number => {
    const band = visibleBand(rootRef.current);
    const plan = planOf(band);
    const move = model.move;
    const clamp = (p: number) => Math.min(1, Math.max(0, p));
    const mover = band?.querySelector<HTMLElement>('[data-anim="mover"]');
    if (band && plan && move && mover) {
      const shift = ((move.to.start - move.from.start) / Math.max(1, plan.track.end - plan.track.start)) * mover.offsetWidth;
      if (Math.abs(shift) >= 1) return clamp(new DOMMatrixReadOnly(getComputedStyle(mover).transform).m41 / shift);
    }
    const fading = band?.querySelector<HTMLElement>('[data-anim="mover@1"]');
    if (fading) return clamp(Number.parseFloat(getComputedStyle(fading).opacity));
    const progress = flightAnims.current[0]?.effect?.getComputedTiming().progress;
    const last = running.current;
    return last && typeof progress === "number" ? last.fromP + (last.toP - last.fromP) * progress : 0;
  }, [model.move, planOf]);

  // The flight: every keyed element of the visible band gets its keyframes, one duration, one curve. A new
  // flight first reads where the running one is, then cancels it, in the same frame, so nothing jumps.
  useLayoutEffect(() => {
    if (!flight) {
      cancelAll(flightAnims);
      running.current = null;
      return;
    }
    const fromP = flight.fromP ?? currentP();
    cancelAll(flightAnims);
    const band = visibleBand(rootRef.current);
    const plan = planOf(band);
    let live = true;
    const done = () => {
      if (live) settle(flight);
    };
    if (!band || !plan || prefersReducedMotion() || Math.abs(flight.toP - fromP) < 1e-6) {
      void Promise.resolve().then(done);
      return () => {
        live = false;
      };
    }
    const frames = flightKeyframes(model, plan, fromP, flight.toP);
    const { duration } = retarget(fromP, flight.toP);
    const animations: Animation[] = [];
    for (const element of band.querySelectorAll<HTMLElement | SVGElement>("[data-anim]")) {
      const list = frames[element.dataset.anim ?? ""];
      if (list) animations.push(element.animate(list, { duration, easing: EASE_MOVE, fill: "forwards" }));
    }
    flightAnims.current = animations;
    running.current = { fromP, toP: flight.toP };
    Promise.all(animations.map((animation) => animation.finished)).then(done, () => {});
    return () => {
      live = false;
    };
  }, [flight, model, planOf, settle, currentP]);

  // Tags and names that differ between the views swap as the drawing settles: out fades, in fades in.
  useLayoutEffect(() => {
    cancelAll(swapAnims);
    if (!swap) return;
    const band = visibleBand(rootRef.current);
    if (!band) return;
    const timing = { duration: TAG_MS, easing: EASE_OUT, fill: "both" as const };
    const animations = [
      ...[...band.querySelectorAll<HTMLElement>('[data-swap="out"]')].map((element) => element.animate([{ opacity: 1 }, { opacity: 0 }], timing)),
      ...[...band.querySelectorAll<HTMLElement>('[data-swap="in"]')].map((element) => element.animate([{ opacity: 0 }, { opacity: 1 }], timing)),
    ];
    swapAnims.current = animations;
    const id = swap.id;
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => setSwap((current) => (current?.id === id ? null : current)),
      () => {},
    );
  }, [swap]);

  // Reduced motion switched on mid-move: finish at once.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      if (!query.matches) return;
      for (const animation of [...flightAnims.current, ...swapAnims.current, ...panAnims.current]) {
        try {
          animation.finish();
        } catch {
          animation.cancel();
        }
      }
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // The phone's detail window: slide from where it is to the new place, or jump under reduced motion. The names the
  // new window adds (it is named again for the window it shows) fade in as it slides; the rest ride with their bars.
  useLayoutEffect(() => {
    const from = panFrom.current;
    const before = panNames.current;
    panFrom.current = null;
    panNames.current = null;
    if (!from) return;
    const band = visibleBand(rootRef.current);
    const added = band && before ? [...band.querySelectorAll<HTMLElement | SVGElement>(PAN_NAMES)].filter((element) => !before.has(nameSig(element))) : [];
    panAnims.current = [
      ...from.map(([element, transform]) => element.animate([{ transform }, { transform: element.style.transform }], { duration: PAN_MS, easing: EASE_MOVE })),
      ...added.map((element) => element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TAG_MS, easing: EASE_OUT })),
    ];
  }, [pan]);

  const panTo = useCallback(
    (minute: number) => {
      const track = trackOf(model);
      const length = model.focus.end - model.focus.start;
      const next = Math.min(Math.max(track.start, track.end - length), Math.max(track.start, minute));
      if (Math.abs(next - pan) < 0.01) return;
      const band = visibleBand(rootRef.current);
      const elements = band ? [...band.querySelectorAll<HTMLElement>("[data-pan-track], [data-bracket]")] : [];
      const from = elements.map((element): [HTMLElement, string] => [element, getComputedStyle(element).transform]);
      cancelAll(panAnims);
      const still = prefersReducedMotion();
      panFrom.current = still ? null : from;
      panNames.current = still || !band ? null : new Set([...band.querySelectorAll<HTMLElement | SVGElement>(PAN_NAMES)].map(nameSig));
      setPan(next);
    },
    [model, pan],
  );

  // A pinned note closes on a press anywhere outside the drawing.
  useEffect(() => {
    if (!pin) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPin(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pin]);

  /**
   * Measured when a note opens: the room on screen above and below the drawing, up to the farthest a note may reach
   * (`NOTE_REACH`, `PHONE_NOTE_BELOW`), and the boxes of what the page shows in the room above it (`shownAbove`).
   */
  const measureReach = () => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;
    const box = root.getBoundingClientRect();
    const phone = visibleBand(root)?.dataset.layout !== "desktop";
    const top = Math.max(0, Math.min(phone ? PHONE_NOTE_ABOVE : NOTE_REACH.top, Math.floor(box.top - NOTE_GAP)));
    const bottom = Math.max(0, Math.min(Math.max(NOTE_REACH.bottom, PHONE_NOTE_BELOW), Math.floor(window.innerHeight - box.bottom - NOTE_GAP)));
    const keep = top > 0 ? shownAbove(root, top + NOTE_GAP) : [];
    const width = box.width;
    setReach((current) =>
      current.top === top && current.bottom === bottom && current.width === width && sameBoxes(current.keep, keep) ? current : { top, bottom, keep, width },
    );
  };

  const shown: GraphView = flight ? flight.target : drawn;
  const { move } = model;
  const description = [keyLine(model), move ? `${move.label}.` : null, move ? sideEffectText(move) : null].filter(Boolean).join(" ");

  const ctx: Ctx = {
    model,
    lockTitle,
    uid,
    drawn,
    shown,
    flight,
    swap,
    pan,
    note: hover ?? pin ?? keyed,
    active,
    reach,
    onLineFocus: (plan, key, event) => {
      measureReach();
      setActive(key);
      // A line reached from the keyboard shows its note, as on hover, without a press.
      if (event.currentTarget.matches(":focus-visible")) setKeyed({ kind: "line", key });
      if (plan.layout === "desktop") return;
      const line = plan.views[shown].lines.find((item) => item.key === key);
      const length = model.focus.end - model.focus.start;
      if (line && (line.mid < pan || line.mid > pan + length)) panTo(line.mid - length / 2);
    },
    onLineBlur: (event) => {
      if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setKeyed(null);
    },
    onLineKey: (plan, key, event) => {
      const order = plan.views[shown].lines
        .slice()
        .sort((a, b) => a.thread.rank - b.thread.rank)
        .map((line) => line.key);
      const { focus: next, unpin } = lineKeyAction(order, key, event.key);
      if (unpin) {
        setPin(null);
        setKeyed(null);
        event.stopPropagation();
        return;
      }
      if (!next) return;
      event.preventDefault();
      measureReach();
      setActive(next);
      setKeyed({ kind: "line", key: next });
      if (pin?.kind === "line") setPin({ kind: "line", key: next });
      const target = event.currentTarget.closest("[data-band]")?.querySelector<HTMLElement>(`[data-hit="${next}"]`);
      target?.focus({ preventScroll: true });
    },
    onLineClick: (key) => {
      measureReach();
      setActive(key);
      setPin((current) => (current?.kind === "line" && current.key === key ? null : { kind: "line", key }));
    },
    onHover: (note) => {
      if (note) measureReach();
      setHover(note);
    },
    onSetClick: (id) => setPin((current) => (current?.kind === "set" && current.id === id ? null : { kind: "set", id })),
    onStripTap: (plan, minute) => {
      const lines = plan.views[shown].lines;
      if (lines.length === 0) return;
      const nearest = lines.reduce((best, line) => (Math.abs(line.mid - minute) < Math.abs(best.mid - minute) ? line : best));
      setActive(nearest.key);
      setPin({ kind: "line", key: nearest.key });
      panTo(nearest.mid - (model.focus.end - model.focus.start) / 2);
    },
  };

  return (
    <div
      ref={rootRef}
      data-day-graph=""
      data-view={view}
      role="group"
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-desc`}
      className={cn("relative text-[12.5px] leading-[15px] text-foreground", className)}
      onPointerDown={(event) => {
        if (!(event.target as Element).closest("[data-hit], [data-set], [data-strip]")) setPin(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && (pin || keyed)) {
          setPin(null);
          setKeyed(null);
        }
      }}
    >
      <p id={`${uid}-title`} className="sr-only">
        {drawingTitle(model, view)}
      </p>
      <p id={`${uid}-desc`} className="sr-only">
        {description}
      </p>
      {layouts.map((layout) => (
        <div key={layout} data-layout={layout} className={forced ? "relative" : LAYOUT_CLASS[layout]} style={{ height: drawingHeight(model, layout) }}>
          {plans[layout].map((plan, index) => (
            <Drawing key={plan.reference} plan={plan} leaders={leaders[layout][index]} ctx={ctx} className={forced ? undefined : BAND_CLASS[plan.reference]} />
          ))}
        </div>
      ))}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

type Ctx = {
  model: DayGraphModel;
  /** The words a lock carries on this day (`lockWords`): whose lock it is. */
  lockTitle: string;
  uid: string;
  drawn: GraphView;
  shown: GraphView;
  flight: Flight | null;
  swap: Swap | null;
  pan: number;
  note: Note | null;
  active: string | null;
  /** The room a line's note may reach into past the drawing's top and foot (px), and what it keeps clear of above the drawing. */
  reach: Reach;
  onLineFocus: (plan: LayoutPlan, key: string, event: FocusEvent<HTMLButtonElement>) => void;
  onLineBlur: (event: FocusEvent<HTMLButtonElement>) => void;
  onLineKey: (plan: LayoutPlan, key: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  onLineClick: (key: string) => void;
  onHover: (note: Note | null) => void;
  onSetClick: (id: string) => void;
  onStripTap: (plan: LayoutPlan, minute: number) => void;
};

/** One band of one layout: the stage names, the time track (panning on a phone), the overview strip and the note layer. */
function Drawing({ plan, leaders, ctx, className }: { plan: LayoutPlan; leaders: Record<GraphView, ViewLeaders>; ctx: Ctx; className?: string }) {
  const { model } = ctx;
  const { layout } = plan;
  const height = drawingHeight(model, layout);
  const top = layout === "phone" ? DETAIL_TOP : 0;
  const panned = layout !== "desktop";
  const length = Math.max(1, plan.track.end - plan.track.start);
  const focus = Math.max(1, model.focus.end - model.focus.start);
  const trackStyle: CSSProperties = panned
    ? { width: pct((length / focus) * 100), transform: `translateX(-${pct(((ctx.pan - plan.track.start) / length) * 100)})` }
    : {};
  return (
    <div data-band={plan.reference} data-layout={layout} className={cn("absolute inset-0", className)}>
      <StageNames layout={layout} plan={plan} model={model} top={top} />
      <div
        className={cn("absolute right-0 bottom-0", panned ? "overflow-clip" : "[overflow-x:clip]")}
        style={{ left: GUTTER[layout], top }}
      >
        <div
          data-pan-track={panned ? "" : undefined}
          className={cn("absolute inset-y-0 left-0", !panned && "right-0")}
          style={trackStyle}
        >
          <Axis layout={layout} plan={plan} />
          <Marks plan={plan} leaders={leaders} ctx={ctx} />
          <Hits plan={plan} ctx={ctx} />
        </div>
      </div>
      {layout === "phone" ? <Strip plan={plan} ctx={ctx} /> : null}
      <NoteLayer plan={plan} ctx={ctx} top={top} height={height} />
    </div>
  );
}

function StageNames({ layout, plan, model, top }: { layout: DrawingLayout; plan: LayoutPlan; model: DayGraphModel; top: number }) {
  const bar = LAYOUT[layout].bar;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-0" style={{ top, width: GUTTER[layout] }}>
      {plan.rows.map((stage, row) => (
        <span
          key={stage}
          data-stage=""
          className="absolute left-0 block truncate pr-2 font-medium"
          style={{ top: barTopOf(layout, row) + (bar - LABEL_LINE) / 2, width: GUTTER[layout] }}
        >
          {model.stages[stage]?.name}
        </span>
      ))}
    </div>
  );
}

/**
 * Clock times along the top. A desktop labels every hour, centred over a short tick. A phone's detail labels
 * every half hour just after a tick the axis's height, so the time at the window's left edge reads whole.
 */
function Axis({ layout, plan }: { layout: DrawingLayout; plan: LayoutPlan }) {
  const desktop = layout === "desktop";
  const step = desktop ? 60 : 30;
  const ticks: number[] = [];
  for (let minute = Math.ceil(plan.track.start / step) * step; minute <= plan.track.end; minute += step) ticks.push(minute);
  const height = LAYOUT[layout].axis;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" style={{ height }}>
      {ticks.map((minute) => {
        const left = pct(trackPct(plan.track, minute));
        const align = !desktop || minute === plan.track.start ? undefined : minute === plan.track.end ? "translateX(-100%)" : "translateX(-50%)";
        return (
          <span key={minute}>
            <span
              data-axis=""
              className={cn("absolute top-0 whitespace-nowrap text-muted-foreground", desktop ? "leading-[15px]" : "pl-[3px] leading-[14px]")}
              style={{ left, transform: align }}
            >
              {formatClock(minute)}
            </span>
            <span className={cn("absolute w-px bg-border-strong", desktop ? "bottom-0 h-1" : "inset-y-0")} style={{ left }} />
          </span>
        );
      })}
    </div>
  );
}

/**
 * A set's bar: white with a hairline edge and 6px corners; a set with no taste signal is muted with a dotted edge
 * (dotted, so a dashed outline keeps its one meaning: the published slot or a new overlap). A locked set carries
 * its lock at the start. Its name is drawn by the label layer, inside the bar or beside it; a set whose name is
 * cut or not drawn keeps its whole name as the bar's title.
 */
function SetBar({
  set,
  span,
  track,
  style,
  slot,
  wash,
  ctx,
  className,
}: {
  set: DayGraphSet;
  span: Span;
  track: Span;
  style: CSSProperties;
  slot: string | undefined;
  wash: { key?: string; transform: string } | null;
  ctx: Ctx;
  className?: string;
}) {
  return (
    <div
      data-set={set.actId}
      data-slot={slot}
      title={slot === "d" || slot === "e" ? set.name : undefined}
      className={cn(
        "pointer-events-auto absolute overflow-hidden rounded-xs",
        set.unscored ? "border border-dotted border-border-strong bg-muted text-muted-foreground" : "border border-border-strong bg-card",
        className,
      )}
      style={{ left: pct(trackPct(track, span.start)), width: spanPct(track, span), ...style }}
      onPointerEnter={() => ctx.onHover({ kind: "set", id: set.actId })}
      onPointerLeave={() => ctx.onHover(null)}
      onClick={() => ctx.onSetClick(set.actId)}
    >
      {wash ? (
        <span data-anim={wash.key} className="absolute inset-y-0 left-0 w-full origin-left bg-shared-wash" style={{ transform: wash.transform }} />
      ) : null}
      {set.locked ? (
        <span title={ctx.lockTitle} className="absolute top-1/2 left-[5px] z-[1] flex -translate-y-1/2">
          <Lock aria-hidden="true" className="size-3" strokeWidth={2.25} />
        </span>
      ) : null}
    </div>
  );
}

/** A name or tag at its spot; `shift` minutes are taken off its anchor when it rides the mover's layer. */
function SpotLabel({
  spot,
  track,
  shift = 0,
  className,
  data,
  dropped = false,
}: {
  spot: Spot;
  track: Span;
  shift?: number;
  className?: string;
  data?: Record<string, string>;
  /** A name outside its bar whose leader could not be drawn clear of the other marks (`planLeaders`). */
  dropped?: boolean;
}) {
  // The box is exactly as wide as the plan measured it (a hair over the text), so what the plan kept clear and
  // over its own bar is what the page draws.
  const style: CSSProperties = {
    left: `calc(${pct(trackPct(track, spot.anchor - shift))} + ${spot.dx}px)`,
    top: spot.top,
    width: spot.width,
    textAlign: spot.align === "end" ? "right" : spot.align === "center" ? "center" : "left",
    transform: spot.align === "end" ? "translateX(-100%)" : spot.align === "center" ? "translateX(-50%)" : undefined,
    // A name set on two lines at the plan's tighter leading, so its plate is as tall as the plan placed it.
    lineHeight: spot.leading ? `${spot.leading}px` : undefined,
  };
  return (
    <span
      {...data}
      className={cn("pointer-events-none absolute whitespace-nowrap", spot.plate && "rounded-sm bg-background px-0.5", className)}
      style={style}
      data-leader-dropped={dropped ? "" : undefined}
    >
      {spot.lines.length === 1 ? spot.lines[0] : spot.lines.map((line) => <span key={line} className="block">{line}</span>)}
    </span>
  );
}

/**
 * A leader: the 1px hairline from a name drawn outside its bar to that bar's edge, in the ink of the drawing's
 * quietest marks (the bars' edges and the axis ticks). A mark, not a control: no text, no focus, no pointer. Placed
 * from its name's anchor minute, so it rides with the name (`shift` minutes off it on the mover's layer) and swaps
 * with it as the drawing settles.
 */
function LeaderMark({ leader, track, shift = 0, swap }: { leader: Leader; track: Span; shift?: number; swap?: "in" | "out" | null }) {
  return (
    <svg
      data-leader={leader.id}
      data-swap={swap ?? undefined}
      aria-hidden="true"
      focusable="false"
      width={1}
      height={1}
      className="pointer-events-none absolute top-0 overflow-visible"
      style={{ left: pct(trackPct(track, leader.anchor - shift)) }}
    >
      <line x1={leader.x0} y1={leader.y0} x2={leader.x1} y2={leader.y1} stroke="var(--border-strong)" strokeWidth={1} />
    </svg>
  );
}

/**
 * A line between the two sets of a clash: its paper casing and its stroke. Drawn over the bars it crosses, or,
 * when a name inside one of them is in its way, beneath them, so the bars hide it there; then its paper casing
 * stops it 2px short of each such bar (`gaps`, px down the line), so it reads as passing behind the bar rather
 * than as a chain of short lines joined to it.
 */
function LineStroke({
  line,
  synthetic,
  transform,
  animKey,
  opacity,
  gaps = [],
}: {
  line: PlanLine;
  synthetic: boolean;
  transform: string;
  animKey?: string;
  opacity?: number;
  gaps?: readonly [number, number][];
}) {
  const height = line.bottom - line.top;
  const color = lineColor(line.thread.lit, synthetic, line.thread.ranked);
  return (
    <div
      data-thread={line.thread.rank}
      data-lit={line.thread.lit ? "" : undefined}
      data-unranked={line.thread.ranked ? undefined : ""}
      data-under={line.under ? "" : undefined}
      data-anim={animKey}
      className="pointer-events-none absolute inset-x-0"
      style={{ top: line.top, height, transform, opacity }}
    >
      <svg aria-hidden="true" focusable="false" width={24} height={Math.max(0, height)} className="absolute top-0 -left-3 overflow-visible">
        {line.thread.lit ? null : (
          <line data-casing="" x1={12} x2={12} y1={0} y2={height} stroke="var(--background)" strokeWidth={line.width + 2 * CASING} />
        )}
        <line data-stroke="" x1={12} x2={12} y1={0} y2={height} stroke={color} strokeWidth={line.width} />
        {gaps.map(([from, to]) => (
          <rect key={from} data-gap="" x={12 - line.width / 2 - CASING} y={from} width={line.width + 2 * CASING} height={Math.max(0, to - from)} rx={CASING} fill="var(--background)" />
        ))}
      </svg>
    </div>
  );
}

/** A line's end dots, one on the edge of each of its two sets, drawn over the bars. */
function LineDots({ line, synthetic, transform, animKey, opacity }: { line: PlanLine; synthetic: boolean; transform: string; animKey?: string; opacity?: number }) {
  const height = line.bottom - line.top;
  const color = lineColor(line.thread.lit, synthetic, line.thread.ranked);
  const dot = line.thread.lit ? 8 : 6;
  const dotStyle: CSSProperties = { width: dot, height: dot, marginLeft: -dot / 2, marginTop: -dot / 2, borderRadius: "50%", background: color };
  return (
    <div data-anim={animKey} className="pointer-events-none absolute inset-x-0" style={{ top: line.top, height, transform, opacity }}>
      <span data-end-dot="" className="absolute top-0 left-0" style={dotStyle} />
      <span data-end-dot="" className="absolute left-0" style={{ ...dotStyle, top: height }} />
    </div>
  );
}

/**
 * The flight's form of a window: a stationary fill revealed between a left and a right edge that only translate,
 * with its 1.5px raspberry edge dashed (a new overlap) or solid (the chosen clash's shared minutes).
 */
function MovingWindow({
  id,
  edges,
  window,
  fills,
  dashed,
  solid = false,
  initial,
  groupKey,
  opacity,
}: {
  id: string;
  edges: string;
  window: PlanWindow;
  fills: string[];
  dashed: boolean;
  solid?: boolean;
  initial: { left: string; right: string };
  groupKey?: string;
  opacity?: number;
}) {
  const { top, bottom } = window;
  const r = Math.min(MARK_RADIUS, (bottom - top) / 2);
  const s = 0.75;
  const edged = dashed || solid;
  const leftMask = `M ${r} ${top} H 100000 V ${bottom} H ${r} A ${r} ${r} 0 0 1 0 ${bottom - r} V ${top + r} A ${r} ${r} 0 0 1 ${r} ${top} Z`;
  const rightMask = `M -100000 ${top} H ${-r} A ${r} ${r} 0 0 1 0 ${top + r} V ${bottom - r} A ${r} ${r} 0 0 1 ${-r} ${bottom} H -100000 Z`;
  const stroke = { fill: "none", stroke: "var(--primary)", strokeWidth: 1.5, ...(dashed ? { strokeDasharray: "4 3" } : {}) };
  return (
    <g data-anim={groupKey} style={{ opacity }}>
      <clipPath id={`${id}-l`}>
        <path data-anim={`${edges}:L`} d={leftMask} style={{ transform: initial.left }} />
      </clipPath>
      <clipPath id={`${id}-r`}>
        <path data-anim={`${edges}:R`} d={rightMask} style={{ transform: initial.right }} />
      </clipPath>
      {edged ? (
        <>
          <clipPath id={`${id}-li`}>
            <path data-anim={`${edges}:L`} d={`M ${r} ${top - 2} H 100000 V ${bottom + 2} H ${r} Z`} style={{ transform: initial.left }} />
          </clipPath>
          <clipPath id={`${id}-ri`}>
            <path data-anim={`${edges}:R`} d={`M -100000 ${top - 2} H ${-r} V ${bottom + 2} H -100000 Z`} style={{ transform: initial.right }} />
          </clipPath>
        </>
      ) : null}
      <g clipPath={`url(#${id}-l)`}>
        <g clipPath={`url(#${id}-r)`}>
          {fills.map((fill) => (
            <rect key={fill} x={0} y={top} width="100%" height={bottom - top} rx={MARK_RADIUS} fill={fill} />
          ))}
          {edged ? (
            <>
              <g clipPath={`url(#${id}-li)`}>
                <g clipPath={`url(#${id}-ri)`}>
                  <line x1={0} x2="100%" y1={top + s} y2={top + s} {...stroke} />
                  <line x1={0} x2="100%" y1={bottom - s} y2={bottom - s} {...stroke} />
                </g>
              </g>
              <path
                data-anim={`${edges}:L`}
                d={`M ${r} ${top + s} A ${r - s} ${r - s} 0 0 0 ${s} ${top + r} V ${bottom - r} A ${r - s} ${r - s} 0 0 0 ${r} ${bottom - s}`}
                style={{ transform: initial.left }}
                {...stroke}
              />
              <path
                data-anim={`${edges}:R`}
                d={`M ${-r} ${top + s} A ${r - s} ${r - s} 0 0 1 ${-s} ${top + r} V ${bottom - r} A ${r - s} ${r - s} 0 0 1 ${-r} ${bottom - s}`}
                style={{ transform: initial.right }}
                {...stroke}
              />
            </>
          ) : null}
        </g>
      </g>
    </g>
  );
}

/**
 * Everything drawn on the track, in paint order: windows (behind the bars), the ghost, the lines that pass
 * beneath the bars, the bars and the mover, the lines drawn over the bars, the end dots, then the leaders from the
 * names outside their bars, then the names (inside the bars, beside them and on their paper plates) and the tags.
 */
function Marks({ plan, leaders, ctx }: { plan: LayoutPlan; leaders: Record<GraphView, ViewLeaders>; ctx: Ctx }) {
  const { model, flight, drawn, swap } = ctx;
  const { track, layout } = plan;
  const move = model.move;
  const bar = LAYOUT[layout].bar;
  const flying = flight !== null;
  const p = flight ? flight.toP : viewP(model, drawn);
  const restView = flight ? flight.from : drawn;
  const pub = plan.views.published;
  const moved = plan.views.moved;
  const rest = plan.views[drawn];
  const crossfade = Boolean(move && move.from.stageIndex !== move.to.stageIndex);
  const hatchId = `${ctx.uid}-${layout}-${plan.reference}-hatch`;
  const setById = new Map(model.sets.map((set) => [set.actId, set]));
  const partner = move ? setById.get(move.partnerId) : undefined;
  const partnerSpan = partner ? { start: partner.start, end: partner.end } : null;
  const lit = model.threads.find((thread) => thread.lit);
  const shiftOf = (view: GraphView) => (move ? moverAt(move, viewP(model, view)).start - move.from.start : 0);
  const labelView = flying ? restView : drawn;

  // The chosen clash's wash inside a bar, as the share of that bar it covers in this frame.
  const washFor = (set: DayGraphSet, span: Span): { key?: string; transform: string } | null => {
    if (move && partnerSpan) {
      if (set.actId === move.partnerId) return { key: "wash:partner", transform: washTransform(partnerSpan, windowAt(move, partnerSpan, p)) };
      if (set.actId === move.actId) return { key: "wash:mover", transform: washTransform(moverAt(move, p), windowAt(move, partnerSpan, p)) };
      return null;
    }
    if (!move && lit && (set.actId === lit.aId || set.actId === lit.bId)) return { transform: washTransform(span, lit.window) };
    return null;
  };

  // --- windows
  const windowRect = (window: PlanWindow) => ({
    x: pct(trackPct(track, window.window.start)),
    y: window.top,
    width: spanPct(track, window.window),
    height: window.bottom - window.top,
  });
  let windows: ReactNode;
  if (flying && move && partnerSpan) {
    const edgesAtP = (other: Span) => {
      const here = moverAt(move, p);
      return { left: edgeTransform(track, Math.max(here.start, other.start)), right: edgeTransform(track, Math.min(here.end, other.end)) };
    };
    const hatchCopies: { window: PlanWindow; groupKey?: string; opacity?: number }[] = crossfade
      ? [
          ...(pub.hatch ? [{ window: pub.hatch, groupKey: "hatch@0", opacity: 1 - p }] : []),
          ...(moved.hatch ? [{ window: moved.hatch, groupKey: "hatch@1", opacity: p }] : []),
        ]
      : (pub.hatch ?? moved.hatch)
        ? [{ window: (pub.hatch ?? moved.hatch) as PlanWindow }]
        : [];
    windows = (
      <>
        {hatchCopies.map((copy, i) => (
          <MovingWindow
            key={`hatch${i}`}
            id={`${hatchId}-m${i}`}
            edges="hatch"
            window={copy.window}
            fills={["var(--shared-wash)", `url(#${hatchId})`]}
            dashed={false}
            solid
            initial={edgesAtP(partnerSpan)}
            groupKey={copy.groupKey}
            opacity={copy.opacity}
          />
        ))}
        {moved.created.map((window) => {
          const other = setById.get(window.change.actId);
          if (!other) return null;
          return (
            <MovingWindow
              key={window.key}
              id={`${hatchId}-${window.change.actId.replace(/[^A-Za-z0-9_-]/g, "")}`}
              edges={window.key}
              window={window}
              fills={["var(--shared-wash)"]}
              dashed
              initial={edgesAtP({ start: other.start, end: other.end })}
              groupKey={window.key}
              opacity={(window.change.before === 0 ? 1 : p) * (crossfade ? p : 1)}
            />
          );
        })}
      </>
    );
  } else {
    windows = (
      <>
        {rest.hatch ? (
          <>
            <rect data-shared-window="" {...windowRect(rest.hatch)} rx={MARK_RADIUS} fill="var(--shared-wash)" />
            <rect {...windowRect(rest.hatch)} rx={MARK_RADIUS} fill={`url(#${hatchId})`} stroke="var(--primary)" strokeWidth={1.5} />
          </>
        ) : null}
        {rest.created.map((window) => (
          <rect
            key={window.key}
            data-created={window.change.actId}
            {...windowRect(window)}
            rx={MARK_RADIUS}
            fill="var(--shared-wash)"
            stroke="var(--primary)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        ))}
      </>
    );
  }

  // --- bars
  const still = pub.bars.filter((item) => !item.mover);
  const moverCopies: { place: PlanBar; key: string; opacity?: number }[] = [];
  if (move) {
    const atPub = pub.bars.find((item) => item.mover);
    const atMoved = moved.bars.find((item) => item.mover);
    if (!crossfade) {
      if (atPub) moverCopies.push({ place: atPub, key: "mover" });
    } else if (flying) {
      if (atPub) moverCopies.push({ place: atPub, key: "mover@0", opacity: 1 - p });
      if (atMoved) moverCopies.push({ place: atMoved, key: "mover@1", opacity: p });
    } else {
      const here = drawn === "moved" ? atMoved : atPub;
      if (here) moverCopies.push({ place: here, key: drawn === "moved" ? "mover@1" : "mover@0" });
    }
  }
  const mover = move ? setById.get(move.actId) : undefined;
  const fromSpan = move ? { start: move.from.start, end: move.from.end } : null;

  // --- lines: at rest where the view stands them; in flight, those that touch the mover at p, the rest sliding
  // between their two places. Each is drawn beneath or over the bars as its resting view draws it.
  type Drawn = { line: PlanLine; key: string; transform: string; opacity?: number };
  const lines: Drawn[] = [];
  if (!flying) {
    for (const line of rest.lines) lines.push({ line, key: `line:${line.key}`, transform: lineTransform(track, line.mid, line.off) });
  } else if (move) {
    const keys = new Set([...pub.lines.map((line) => line.key), ...moved.lines.map((line) => line.key)]);
    for (const key of keys) {
      const a = pub.lines.find((line) => line.key === key);
      const b = moved.lines.find((line) => line.key === key);
      const base = (plan.views[restView].lines.find((line) => line.key === key) ?? a ?? b) as PlanLine;
      const offAt = lerp(a?.off ?? b?.off ?? 0, b?.off ?? a?.off ?? 0, p);
      if (!base.moving) {
        lines.push({ line: base, key: `line:${key}`, transform: lineTransform(track, lerp(a?.mid ?? base.mid, b?.mid ?? base.mid, p), offAt) });
        continue;
      }
      const otherId = base.thread.aId === move.actId ? base.thread.bId : base.thread.aId;
      const other = setById.get(otherId);
      if (!other) continue;
      const otherSpan = { start: other.start, end: other.end };
      const mid = movingLineAt(move, otherSpan, p, a?.frac ?? b?.frac ?? 0.5, b?.frac ?? a?.frac ?? 0.5);
      const present = windowAt(move, otherSpan, p) !== null;
      const transform = lineTransform(track, mid, offAt);
      if (!crossfade) {
        lines.push({ line: base, key: `line:${key}`, transform, opacity: present ? undefined : 0 });
      } else {
        if (a) lines.push({ line: a, key: `line:${key}@0`, transform, opacity: present ? 1 - p : 0 });
        if (b) lines.push({ line: b, key: `line:${key}@1`, transform, opacity: present ? p : 0 });
      }
    }
  }
  // A line drawn beneath the bars it crosses: where each of those bars (the mover's excepted in flight) hides it,
  // px down the line, widened by the casing.
  const gapsOf = (line: PlanLine): [number, number][] => {
    if (!line.under) return [];
    const at = (line.mid - track.start) * plan.scale + line.off;
    return plan.views[restView].bars
      .filter((item) => item.row > line.upper && item.row < line.lower && !(flying && item.mover))
      .filter((item) => (item.span.start - track.start) * plan.scale <= at + line.width / 2 && at - line.width / 2 <= (item.span.end - track.start) * plan.scale)
      .map((item): [number, number] => [item.top - CASING - line.top, item.top + bar + CASING - line.top]);
  };
  const strokeOf = (item: Drawn) => (
    <LineStroke key={item.key} line={item.line} synthetic={model.synthetic} transform={item.transform} animKey={item.key} opacity={item.opacity} gaps={gapsOf(item.line)} />
  );

  // --- names and tags: the resting view's while in flight (they swap when it settles).
  const nameOf = (id: string) => setById.get(id);
  type Item = { key: string; id: string; spot: Spot; mover: boolean; tag: boolean; sig: string };
  const itemsAt = (view: GraphView): Item[] => [
    ...Object.entries(plan.views[view].labels).map(([id, spot]): Item => {
      const isMover = id === move?.actId;
      // The mover's name is known by where it sits on its bar, which travels; any other by where it sits.
      const sig = isMover ? `mover|${spotSignature(spot, spot.anchor - shiftOf(view))}` : `${id}|${spotSignature(spot, spot.anchor)}`;
      return { key: `label:${id}`, id, spot, mover: isMover, tag: false, sig };
    }),
    ...plan.views[view].tags.map((tag): Item => ({ key: `tag:${tag.key}`, id: tag.key, spot: tag.spot, mover: false, tag: true, sig: `tag|${spotSignature(tag.spot, tag.spot.anchor)}` })),
  ];
  const showing = itemsAt(labelView);
  let incoming = new Set<string>();
  let outgoing: Item[] = [];
  if (swap && !flying) {
    const before = itemsAt(swap.from);
    const beforeIds = new Set(before.map((item) => item.sig));
    const afterIds = new Set(showing.map((item) => item.sig));
    incoming = new Set(showing.filter((item) => !beforeIds.has(item.sig)).map((item) => item.sig));
    outgoing = before.filter((item) => !afterIds.has(item.sig));
  }
  const renderItem = (item: Item, view: GraphView, shift: number, mark: "in" | "out" | null) => {
    const set = nameOf(item.id);
    const inBar = item.spot.kind === "inside" || item.spot.kind === "prefix";
    return (
      <SpotLabel
        key={`${mark ?? "on"}-${item.key}-${item.spot.lines.join("/")}`}
        spot={item.spot}
        track={track}
        shift={shift}
        dropped={!item.tag && leaders[view].dropped.includes(item.id)}
        className={cn(
          item.tag || set?.featured ? "font-semibold" : "font-medium",
          item.tag && "text-primary",
          !item.tag && inBar && set?.unscored && "text-muted-foreground",
        )}
        data={{
          [item.tag ? "data-shared-tag" : "data-label"]: item.id,
          ...(item.spot.slot ? { "data-slot": item.spot.slot } : {}),
          ...(mark ? { "data-swap": mark } : {}),
        }}
      />
    );
  };
  const fixedItems = showing.filter((item) => !item.mover);
  const moverItems = showing.filter((item) => item.mover);
  const leavingMover = outgoing.filter((item) => item.mover);
  const leavingFixed = outgoing.filter((item) => !item.mover);
  const slots = plan.views[labelView].slots;

  // --- leaders: like the names, the resting view's while in flight, the mover's on the mover's layer; one that
  // differs between the views swaps with the names as the drawing settles.
  type LeaderItem = { key: string; leader: Leader; mover: boolean; sig: string };
  const leadersAt = (view: GraphView): LeaderItem[] =>
    leaders[view].leaders.map((leader) => {
      const isMover = leader.id === move?.actId;
      const at = isMover ? leader.anchor - shiftOf(view) : leader.anchor;
      const sig = `${leader.id}|${[at, leader.x0, leader.y0, leader.x1, leader.y1].map((value) => Math.round(value * 100)).join("|")}`;
      return { key: `leader:${leader.id}`, leader, mover: isMover, sig };
    });
  const showingLeaders = leadersAt(labelView);
  let incomingLeaders = new Set<string>();
  let outgoingLeaders: LeaderItem[] = [];
  if (swap && !flying) {
    const before = leadersAt(swap.from);
    const beforeSigs = new Set(before.map((item) => item.sig));
    const afterSigs = new Set(showingLeaders.map((item) => item.sig));
    incomingLeaders = new Set(showingLeaders.filter((item) => !beforeSigs.has(item.sig)).map((item) => item.sig));
    outgoingLeaders = before.filter((item) => !afterSigs.has(item.sig));
  }
  const renderLeader = (item: LeaderItem, shift: number, mark: "in" | "out" | null) => (
    <LeaderMark key={`${mark ?? "on"}-${item.sig}`} leader={item.leader} track={track} shift={shift} swap={mark} />
  );
  const fixedLeaders = showingLeaders.filter((item) => !item.mover);
  const moverLeaders = showingLeaders.filter((item) => item.mover);
  const leavingMoverLeaders = outgoingLeaders.filter((item) => item.mover);
  const leavingFixedLeaders = outgoingLeaders.filter((item) => !item.mover);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <svg aria-hidden="true" focusable="false" className="absolute inset-0 size-full overflow-visible">
        <defs>
          {/* The hatch: one 1.5px raspberry line every 6px at 45 degrees, laid over the wash. */}
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
            <line x1={3} y1={0} x2={3} y2={6} stroke="var(--primary)" strokeWidth={1.5} />
          </pattern>
        </defs>
        {windows}
      </svg>

      {move && fromSpan && moved.ghost && (flying || drawn === "moved") ? (
        <div
          data-ghost=""
          data-anim={flying ? "ghost" : undefined}
          className="absolute rounded-xs border-[1.5px] border-dashed border-foreground"
          style={{
            left: pct(trackPct(track, fromSpan.start)),
            width: spanPct(track, fromSpan),
            top: moved.ghost.top,
            height: bar,
            opacity: flying ? p : undefined,
          }}
        />
      ) : null}

      {lines.filter((item) => item.line.under).map(strokeOf)}

      {still.map((item) => (
        <SetBar
          key={item.set.actId}
          set={item.set}
          span={item.span}
          track={track}
          style={{ top: item.top, height: bar }}
          slot={slots[item.set.actId]}
          wash={washFor(item.set, item.span)}
          ctx={ctx}
        />
      ))}
      {move && mover && fromSpan
        ? moverCopies.map((copy) => (
            <div
              key={copy.key}
              data-anim={copy.key}
              className="pointer-events-none absolute inset-x-0"
              style={{ top: copy.place.top, height: bar, transform: moverTransform(track, move, p), opacity: copy.opacity }}
            >
              <SetBar
                set={mover}
                span={fromSpan}
                track={track}
                style={{ top: 0, height: bar }}
                slot={slots[mover.actId]}
                wash={washFor(mover, fromSpan)}
                ctx={ctx}
              />
            </div>
          ))
        : null}

      {lines.filter((item) => !item.line.under).map(strokeOf)}
      {lines.map((item) => (
        <LineDots key={`dots-${item.key}`} line={item.line} synthetic={model.synthetic} transform={item.transform} animKey={item.key} opacity={item.opacity} />
      ))}

      {fixedLeaders.map((item) => renderLeader(item, 0, incomingLeaders.has(item.sig) ? "in" : null))}
      {fixedItems.map((item) => renderItem(item, labelView, 0, incoming.has(item.sig) ? "in" : null))}
      {move && (moverItems.length || moverLeaders.length)
        ? moverCopies
            .filter((copy) => !crossfade || copy.key === (labelView === "moved" ? "mover@1" : "mover@0"))
            .map((copy) => (
              <div
                key={`label-${copy.key}`}
                data-anim={copy.key}
                className="pointer-events-none absolute inset-0"
                style={{ transform: moverTransform(track, move, p), opacity: copy.opacity }}
              >
                {moverLeaders.map((item) => renderLeader(item, shiftOf(labelView), incomingLeaders.has(item.sig) ? "in" : null))}
                {moverItems.map((item) => renderItem(item, labelView, shiftOf(labelView), incoming.has(item.sig) ? "in" : null))}
              </div>
            ))
        : null}
      {move && swap && (leavingMover.length || leavingMoverLeaders.length) ? (
        // The mover's old name and leader ride the mover's layer, now at the new view's place, so they stay on its bar.
        <div className="pointer-events-none absolute inset-0" style={{ transform: moverTransform(track, move, p) }}>
          {leavingMoverLeaders.map((item) => renderLeader(item, shiftOf(swap.from), "out"))}
          {leavingMover.map((item) => renderItem(item, swap.from, shiftOf(swap.from), "out"))}
        </div>
      ) : null}
      {leavingFixedLeaders.map((item) => renderLeader(item, 0, "out"))}
      {leavingFixed.map((item) => renderItem(item, swap?.from ?? labelView, 0, "out"))}
    </div>
  );
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/**
 * The lines' hit areas: one tab stop for the band, each a 46px target with 10px corners (at least 44px after
 * any rounding) that moves with its line. They sit over the names, so a focus ring is never hidden by one.
 */
function Hits({ plan, ctx }: { plan: LayoutPlan; ctx: Ctx }) {
  const { model, flight, shown } = ctx;
  const move = model.move;
  const view = plan.views[shown];
  const order = view.lines.slice().sort((a, b) => a.thread.rank - b.thread.rank);
  if (order.length === 0) return null;
  const keys = order.map((line) => line.key);
  const litKey = order.find((line) => line.thread.lit)?.key;
  const roving = ctx.active && keys.includes(ctx.active) ? ctx.active : (litKey ?? keys[0]);
  const p = flight ? flight.toP : viewP(model, ctx.drawn);
  const crossfade = Boolean(move && move.from.stageIndex !== move.to.stageIndex);
  const otherView: GraphView = shown === "moved" ? "published" : "moved";
  return (
    <div className="pointer-events-none absolute inset-0 z-[2]">
      {order.map((line) => {
        let transform = lineTransform(plan.track, line.mid, line.off);
        if (flight && move && line.moving) {
          const other = plan.views[otherView].lines.find((item) => item.key === line.key);
          transform = lineTransform(plan.track, lineMid(model, line, other, p, shown === "published"), line.off);
        }
        const animKey = `line:${line.key}${crossfade && line.moving ? (shown === "moved" ? "@1" : "@0") : ""}`;
        return (
          <div key={line.key} data-anim={animKey} className="absolute inset-x-0" style={{ top: line.top, height: line.bottom - line.top, transform }}>
            <button
              type="button"
              data-hit={line.key}
              data-unranked={line.thread.ranked ? undefined : ""}
              tabIndex={line.key === roving ? 0 : -1}
              aria-label={threadNote(model, line.thread, shown)}
              className="pointer-events-auto absolute top-1/2 left-0 size-11.5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-md"
              onFocus={(event) => ctx.onLineFocus(plan, line.key, event)}
              onBlur={(event) => ctx.onLineBlur(event)}
              onKeyDown={(event) => ctx.onLineKey(plan, line.key, event)}
              onClick={() => ctx.onLineClick(line.key)}
              onPointerEnter={() => ctx.onHover({ kind: "line", key: line.key })}
              onPointerLeave={() => ctx.onHover(null)}
            />
          </div>
        );
      })}
    </div>
  );
}

/** A set's mark in the phone's overview strip (px tall). */
const STRIP_MARK = 2;

/**
 * The phone's overview: each stage a 1px track, each set a 2px mark on it (1px clear of its neighbours), every line
 * of the day at 1px, solid, in the quiet taste ink, the chosen clash's shared minutes in raspberry on its two
 * marks, and a bracket on the detail window. A tap selects the nearest drawn line and slides the detail to it;
 * nothing in it takes focus.
 */
function Strip({ plan, ctx }: { plan: LayoutPlan; ctx: Ctx }) {
  const { model, flight, drawn } = ctx;
  const { track } = plan;
  const move = model.move;
  const stages = Math.max(1, model.stages.length);
  // Each stage's row, from the strip's top to its foot, its 2px mark on whole pixels where the strip allows.
  const step = stages > 1 ? (LAYOUT.phone.overview - STRIP_MARK) / (stages - 1) : 0;
  const rowTop = (stage: number) => Math.round(stage * step);
  const height = STRIP_MARK;
  const p = flight ? flight.toP : viewP(model, drawn);
  const flying = flight !== null;
  const crossfade = Boolean(move && move.from.stageIndex !== move.to.stageIndex);
  const length = Math.max(1, track.end - track.start);
  const focus = Math.max(1, model.focus.end - model.focus.start);
  const setById = new Map(model.sets.map((set) => [set.actId, set]));
  const stageOf = (set: DayGraphSet, view: GraphView) => (move && view === "moved" && set.actId === move.actId ? move.to.stageIndex : set.stageIndex);
  const views: GraphView[] = flying ? ["published", "moved"] : [drawn];

  const strokes: { key: string; thread: DayGraphThread; mid: number; top: number; bottom: number; animKey?: string; opacity?: number }[] = [];
  const seenKeys = new Set<string>();
  for (const view of views) {
    for (const thread of model.threads) {
      const a = setById.get(thread.aId);
      const b = setById.get(thread.bId);
      if (!a || !b) continue;
      const moving = Boolean(move && thread.moved);
      const window = view === "moved" && move && thread.moved ? thread.moved.window : thread.window;
      if (!window && !flying) continue;
      const rowA = stageOf(a, view);
      const rowB = stageOf(b, view);
      if (rowA === rowB) continue;
      const key = `${thread.aId}~${thread.bId}`;
      const copy = crossfade && moving ? (view === "moved" ? "@1" : "@0") : "";
      if (seenKeys.has(key + copy)) continue;
      if (!moving && seenKeys.has(key)) continue;
      seenKeys.add(key + copy);
      let mid = window ? (window.start + window.end) / 2 : (thread.window.start + thread.window.end) / 2;
      let opacity: number | undefined;
      if (flying && move && moving) {
        const other = setById.get(thread.aId === move.actId ? thread.bId : thread.aId);
        if (!other) continue;
        const here = moverAt(move, p);
        mid = (Math.max(here.start, other.start) + Math.min(here.end, other.end)) / 2;
        const present = windowAt(move, { start: other.start, end: other.end }, p) !== null;
        opacity = (present ? 1 : 0) * (crossfade ? (view === "moved" ? p : 1 - p) : 1);
      } else if (!window) {
        continue;
      }
      const upper = Math.min(rowA, rowB);
      const lower = Math.max(rowA, rowB);
      strokes.push({
        key: key + copy,
        thread,
        mid,
        top: rowTop(upper) + height,
        bottom: rowTop(lower),
        animKey: flying && moving ? `sline:${key}${copy}` : undefined,
        opacity,
      });
    }
  }

  // The chosen clash's shared minutes, in raspberry on both its marks, where the drawing rests (a move's flight
  // draws them again where it settles).
  const lit = model.threads.find((thread) => thread.lit);
  const shared: { key: string; window: Span; stage: number }[] = [];
  if (lit && !flying) {
    const window = move && drawn === "moved" && lit.moved ? lit.moved.window : lit.window;
    for (const id of window ? [lit.aId, lit.bId] : []) {
      const set = setById.get(id);
      if (set && window) shared.push({ key: id, window, stage: stageOf(set, drawn) });
    }
  }

  const moverSet = move ? setById.get(move.actId) : undefined;
  const moverRows: { key: string; stage: number; opacity?: number }[] = [];
  if (move && moverSet) {
    if (!crossfade) moverRows.push({ key: "mover", stage: move.from.stageIndex });
    else if (flying) {
      moverRows.push({ key: "mover@0", stage: move.from.stageIndex, opacity: 1 - p });
      moverRows.push({ key: "mover@1", stage: move.to.stageIndex, opacity: p });
    } else moverRows.push({ key: drawn === "moved" ? "mover@1" : "mover@0", stage: drawn === "moved" ? move.to.stageIndex : move.from.stageIndex });
  }
  // A mark keeps half a pixel off each end of its set, so two sets back to back on a track stay 1px apart.
  const along = (span: Span) => ({ left: `calc(${pct(trackPct(track, span.start))} + 0.5px)`, width: `max(1px, calc(${spanPct(track, span)} - 1px))` });
  const mark = (set: DayGraphSet, span: Span, top: number) => (
    <span
      key={set.actId}
      data-strip-mark={set.actId}
      className={cn("absolute rounded-xs", set.unscored ? "bg-border" : "bg-border-strong")}
      style={{ ...along(span), top, height }}
    />
  );
  const quiet = (thread: DayGraphThread) => lineColor(false, model.synthetic, thread.ranked);

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    ctx.onStripTap(plan, track.start + ((event.clientX - box.left) / box.width) * length);
  };

  return (
    <div
      data-strip=""
      aria-hidden="true"
      className="absolute top-0 right-0 cursor-pointer [overflow-x:clip]"
      style={{ left: GUTTER.phone, height: LAYOUT.phone.overview }}
      onClick={onClick}
    >
      {model.stages.map((stage, row) => (
        <span key={stage.id} data-strip-track="" className="absolute inset-x-0 h-px bg-border" style={{ top: rowTop(row) + (height - 1) / 2 }} />
      ))}
      {model.sets.filter((set) => set.actId !== move?.actId).map((set) => mark(set, { start: set.start, end: set.end }, rowTop(set.stageIndex)))}
      {moverSet && move
        ? moverRows.map((row) => (
            <div
              key={row.key}
              data-anim={row.key}
              className="absolute inset-x-0 top-0"
              style={{ transform: moverTransform(track, move, p), opacity: row.opacity }}
            >
              {mark(moverSet, { start: move.from.start, end: move.from.end }, rowTop(row.stage))}
            </div>
          ))
        : null}
      {shared.map((item) => (
        <span key={item.key} data-strip-shared={item.key} className="absolute rounded-xs bg-primary" style={{ ...along(item.window), top: rowTop(item.stage), height }} />
      ))}
      {strokes.map((stroke) => (
        <div
          key={stroke.key}
          data-anim={stroke.animKey}
          className="absolute inset-x-0"
          style={{ top: stroke.top, height: Math.max(0, stroke.bottom - stroke.top), transform: lineTransform(track, stroke.mid, 0), opacity: stroke.opacity }}
        >
          <span data-strip-line={stroke.thread.rank} className="absolute inset-y-0 left-0 w-px" style={{ marginLeft: -0.5, background: quiet(stroke.thread) }} />
        </div>
      ))}
      <span
        data-bracket=""
        className="absolute -top-0.5 -bottom-0.5 left-0 rounded-xs border-2 border-foreground"
        style={{ width: pct((focus / length) * 100), transform: `translateX(${pct(((ctx.pan - track.start) / focus) * 100)})` }}
      />
      {/* The tap target reaches 44px tall over the gap, the detail's axis and the paper above its first row's bars, which take no presses. */}
      <span className="absolute inset-x-0 top-0 h-11" />
    </div>
  );
}

/**
 * The note's width on a desktop and on a phone (px; a phone's is capped by the drawing's own width). A desktop's is
 * wide enough that a line's note takes three lines, short enough to sit past the drawing's foot over the key.
 */
const NOTE_WIDTH: Record<DrawingLayout, number> = { desktop: 500, phone: 352, short: 352 };
/** A note's text size, line box and padding (px): 13/18 with 8px above and below and a 1px edge. */
const NOTE_LINE = 18;
const NOTE_PAD = 18;

/**
 * How tall a note of `text` wraps to at `width` px: an estimate a little over the real height, with a fifth of a
 * line kept for the room word wrapping leaves at each line's end.
 */
function noteHeight(text: string, width: number): number {
  const lines = Math.max(1, Math.ceil(textWidth(text, 13, 500) / Math.max(1, width - 24) + 0.2));
  return lines * NOTE_LINE + NOTE_PAD;
}

/**
 * The note for the line or set under the pointer, pinned by a tap, Enter or Space, or reached from the
 * keyboard: an overlay that moves nothing on the page. A line's note never covers its line or either of the
 * line's two sets and their names, nor what the page shows above the drawing: it goes beside, above or below them
 * where it covers the fewest other names and bars, inside the drawing when a place there covers at most one other
 * name, else past the drawing's top (beside the view toggle) or foot (over the key line; on a phone, over the
 * decision under the drawing). A set's note goes above or below the set, inside the drawing.
 */
function NoteLayer({ plan, ctx, top, height }: { plan: LayoutPlan; ctx: Ctx; top: number; height: number }) {
  const { model, note, shown } = ctx;
  if (!note) return null;
  const { layout, track } = plan;
  const view = plan.views[shown];
  const desktop = layout === "desktop";
  const focus = Math.max(1, model.focus.end - model.focus.start);
  const bar = LAYOUT[layout].bar;
  const gutter = GUTTER[layout];
  const column = desktop ? plan.reference : plan.reference + gutter;
  const width = Math.min(NOTE_WIDTH[layout], column);
  /** A minute plus px across the note's column: the track on a desktop; the whole box, stage names included, on a phone. */
  const across = (minute: number, px: number) =>
    desktop
      ? `${pct(trackPct(track, minute))} + ${Math.round(px * 100) / 100}px`
      : `${gutter}px + (100% - ${gutter}px) * ${Math.round(((minute - ctx.pan) / focus) * 10000) / 10000} + ${Math.round(px * 100) / 100}px`;
  /** The same at the band's reference width, to choose a side. */
  const acrossPx = (minute: number, px: number) => (desktop ? (minute - track.start) * plan.scale + px : gutter + (minute - ctx.pan) * plan.scale + px);

  let text = "";
  let minute = 0;
  let off = 0;
  // The marks the note must leave in sight: as CSS edges (minute + px) and as px at the reference width.
  const parts: { left: [number, number]; right: [number, number]; y0: number; y1: number }[] = [];
  if (note.kind === "line") {
    const line = view.lines.find((item) => item.key === note.key);
    if (!line) return null;
    text = threadNote(model, line.thread, shown);
    minute = line.mid;
    off = line.off;
    parts.push({ left: [line.mid, line.off - 4], right: [line.mid, line.off + 4], y0: line.top, y1: line.bottom });
    for (const id of [line.thread.aId, line.thread.bId]) {
      const item = view.bars.find((entry) => entry.set.actId === id);
      if (item) parts.push({ left: [item.span.start, 0], right: [item.span.end, 0], y0: item.top, y1: item.top + bar });
      const spot = view.labels[id];
      if (spot) {
        const box = spotBox({ track, scale: plan.scale }, spot);
        const base = (spot.anchor - track.start) * plan.scale;
        parts.push({ left: [spot.anchor, box.x0 - base], right: [spot.anchor, box.x1 - base], y0: box.y0, y1: box.y1 });
      }
    }
  } else {
    const item = view.bars.find((entry) => entry.set.actId === note.id);
    if (!item) return null;
    text = setNote(model, item.set, shown);
    minute = (item.span.start + item.span.end) / 2;
    parts.push({ left: [item.span.start, 0], right: [item.span.end, 0], y0: item.top, y1: item.top + bar });
  }
  const marks = {
    x0: Math.min(...parts.map((part) => acrossPx(...part.left))),
    x1: Math.max(...parts.map((part) => acrossPx(...part.right))),
    y0: top + Math.min(...parts.map((part) => part.y0)),
    y1: top + Math.max(...parts.map((part) => part.y1)),
  };
  const tall = noteHeight(text, width);
  const key = `${note.kind}-${note.kind === "line" ? note.key : note.id}-${shown}`;
  const noteClass =
    "pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-3 py-2 text-[13px] leading-[18px] text-foreground transition-[opacity,translate] duration-(--dur-feedback) ease-(--ease-out) starting:translate-y-[3px] starting:opacity-0 motion-reduce:transition-none";
  const style: CSSProperties = { width };

  if (note.kind === "line") {
    // A line's note: of the places beside, above and below the line's own marks, the one that covers the fewest other
    // names, then the fewest other bars (`placeNote`), never over what the page shows above the drawing. A desktop's
    // is placed across the band's track and held in proportion at any wider one inside the band; a phone's across
    // the whole drawing, stage names included, over the detail window it shows.
    const line = view.lines.find((item) => item.key === note.key);
    if (!line) return null;
    const ownIds = [line.thread.aId, line.thread.bId];
    const scaled = { track, scale: plan.scale };
    // From px along the track to px across the note's column: none on a desktop; on a phone, past the stage names
    // and the panned-off minutes.
    const shift = desktop ? 0 : gutter + (track.start - ctx.pan) * plan.scale;
    const left = desktop ? 0 : gutter;
    const seenBox = (box: NoteBox): NoteBox | null => {
      const x0 = Math.max(left, box.x0 + shift);
      const x1 = Math.min(column, box.x1 + shift);
      return x1 > x0 ? { x0, x1, y0: box.y0 + top, y1: box.y1 + top } : null;
    };
    const boxes = (list: NoteBox[]) => list.flatMap((box) => seenBox(box) ?? []);
    const barOf = (item: PlanBar): NoteBox => ({ x0: (item.span.start - track.start) * plan.scale, x1: (item.span.end - track.start) * plan.scale, y0: item.top, y1: item.top + bar });
    const lineX = (line.mid - track.start) * plan.scale + line.off + shift;
    const ownMarks = [
      { x0: lineX - 4, x1: lineX + 4, y0: line.top + top, y1: line.bottom + top },
      ...boxes(view.bars.filter((item) => ownIds.includes(item.set.actId)).map(barOf)),
      ...boxes(ownIds.flatMap((id) => (view.labels[id] ? [spotBox(scaled, view.labels[id])] : []))),
    ];
    const names = boxes([
      ...Object.entries(view.labels)
        .filter(([id]) => !ownIds.includes(id))
        .map(([, spot]) => spotBox(scaled, spot)),
      ...view.tags.map((tag) => spotBox(scaled, tag.spot)),
    ]);
    const bars = boxes(view.bars.filter((item) => !ownIds.includes(item.set.actId)).map(barOf));
    // Its usual shape first; on a desktop, where that finds no place, a wider one of two lines, which fits the room
    // the page leaves above the drawing on a laptop's first screen.
    const twoLines = Math.ceil(textWidth(text, 13, 500) / 1.8) + 25;
    const shapes = [{ width, height: tall }, ...(desktop && twoLines > width && twoLines <= column ? [{ width: twoLines, height: noteHeight(text, twoLines) }] : [])];
    // What the page shows above the drawing, from px across the drawing to px across the note's column.
    const toColumn = ctx.reach.width > gutter - left ? column / (ctx.reach.width - (gutter - left)) : 1;
    const keep = ctx.reach.keep.map((item) => ({ x0: (item.x0 - (gutter - left)) * toColumn, x1: (item.x1 - (gutter - left)) * toColumn, y0: item.y0, y1: item.y1 }));
    const reach = {
      top: Math.min(desktop ? NOTE_REACH.top : PHONE_NOTE_ABOVE, ctx.reach.top),
      bottom: Math.min(desktop ? NOTE_REACH.bottom : PHONE_NOTE_BELOW, ctx.reach.bottom),
    };
    const spot = placeNote(ownMarks, names, bars, { width: column, height }, shapes, lineX, reach, keep);
    const union = { x0: Math.min(...ownMarks.map((item) => item.x0)), x1: Math.max(...ownMarks.map((item) => item.x1)), y0: Math.min(...ownMarks.map((item) => item.y0)) };
    const side = spot.x >= union.x1 ? "right" : spot.x + spot.width <= union.x0 ? "left" : spot.y + spot.height <= union.y0 ? "above" : "below";
    style.width = spot.width;
    style.left = pct((spot.x / Math.max(1, column)) * 100);
    // Held by its edge nearest the marks, so a note a little shorter than the estimate keeps its gap from them.
    if (side === "above") style.bottom = height - (spot.y + spot.height);
    else style.top = spot.y;
    return (
      <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: desktop ? gutter : 0 }}>
        <div key={key} data-thread-note="line" data-note-side={side} className={noteClass} style={style}>
          {text}
        </div>
      </div>
    );
  }

  const place = notePlace({ ...marks, x0: 0, x1: column }, { width: column, height }, { width, height: tall });
  if (place.side === "left" || place.side === "right") {
    // Beside: its near edge 6px off the marks' far edge, its top level with theirs (or its bottom, near the drawing's foot).
    const edges = parts.map((part) => `calc(${across(...(place.side === "right" ? part.right : part.left))})`).join(", ");
    if (place.side === "right") style.left = `calc(${parts.length > 1 ? `max(${edges})` : edges} + ${NOTE_GAP}px)`;
    else style.right = `calc(100% - ${parts.length > 1 ? `min(${edges})` : edges} + ${NOTE_GAP}px)`;
    if (marks.y0 + tall <= height) style.top = marks.y0;
    else style.bottom = Math.max(0, height - marks.y1);
  } else {
    // Above or below the marks, centred on the line and kept inside the drawing's width. A line's note reaches
    // past the drawing's top or foot when the drawing has no room for it there; a set's stays inside.
    style.left = `clamp(0px, calc(${across(minute, off)} - ${width}px / 2), calc(100% - ${width}px))`;
    const inside = note.kind === "set" ? Math.max(0, height - tall) : Number.POSITIVE_INFINITY;
    if (place.side === "above") style.bottom = Math.min(height - marks.y0 + NOTE_GAP, inside);
    else style.top = Math.min(marks.y1 + NOTE_GAP, inside);
  }
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: desktop ? gutter : 0 }}>
      <div key={key} data-thread-note={note.kind} data-note-side={place.side} className={noteClass} style={style}>
        {text}
      </div>
    </div>
  );
}

/** The key under the drawing: what the lines are and what their width and dashes mean. */
export function DayGraphKey({ model, className }: { model: DayGraphModel; className?: string }) {
  return (
    <p data-day-graph-key="" className={className}>
      {keyLine(model)}
    </p>
  );
}
