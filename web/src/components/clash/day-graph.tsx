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
  PAN_MS,
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
  type Span,
} from "@/lib/day-graph";
import {
  barTopOf,
  CASING,
  DETAIL_TOP,
  edgeTransform,
  flightKeyframes,
  GUTTER,
  holdsName,
  LABEL_LINE,
  lineTransform,
  MARK_RADIUS,
  NARROW_TRACK,
  moverAt,
  moverTransform,
  NAME_INSET,
  noteSide,
  pct,
  planDrawing,
  retarget,
  trackPct,
  viewP,
  washTransform,
  windowAt,
  type LayoutPlan,
  type PlanBar,
  type PlanLine,
  type PlanWindow,
  lineColor,
  lineKeyAction,
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
 * A move in flight to the displacement the asked-for view draws, from the resting view `from`; `fromP` is
 * null when it takes over from a running flight, whose place is read off the screen.
 */
type Flight = { id: number; from: GraphView; fromP: number | null; toP: number; target: GraphView };
type Settled = { id: number; view: GraphView };
/** The tags and names swapped when the drawing settles on a view whose labels differ. */
type Swap = { id: number; from: GraphView; to: GraphView };
type Note = { kind: "line"; key: string } | { kind: "set"; id: string };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The layout box the visitor sees (the other two are display: none). */
function visibleLayout(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  for (const element of root.querySelectorAll<HTMLElement>("[data-layout]")) if (element.getClientRects().length > 0) return element;
  return null;
}

function cancelAll(list: { current: Animation[] }) {
  for (const animation of list.current) animation.cancel();
  list.current = [];
}

const spanPct = (track: Span, span: Span) => pct(((span.end - span.start) / Math.max(1, track.end - track.start)) * 100);

/** What identifies a label on screen, so the drawing swaps only those that change between views. */
function spotSignature(spot: Spot, text: string, anchor: number): string {
  return [text, spot.kind, Math.round(anchor * 100), spot.dx, spot.top, spot.align].join("|");
}

/**
 * The hero's drawing of one festival day: every set on its stage row, the day's ranked clashes as straight
 * lines between the two sets of each (thicker for a higher taste overlap rank), and the decision's move with
 * its published slot dashed, the chosen clash's shared minutes hatched and every overlap the move starts drawn
 * dashed. The server renders the final frame of `view`; changing `view` moves the set in 450ms, every window
 * and line that touches it following the same displacement, and announces the result once when it settles.
 */
export function DayGraph(props: {
  model: DayGraphModel;
  view: GraphView;
  onSettled?: (view: GraphView) => void;
  className?: string;
}) {
  const { model, view, onSettled, className } = props;
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  // A phone's plan is laid out for the narrowest phone (lines spread for 320px, names placed for it); `wides`
  // places the names and tags again for phones from 360px, and the drawing shows whichever set fits.
  const plans = useMemo(
    () => ({ desktop: planDrawing(model, "desktop"), phone: planDrawing(model, "phone", NARROW_TRACK), short: planDrawing(model, "short", NARROW_TRACK) }),
    [model],
  );
  const wides = useMemo(() => ({ phone: planDrawing(model, "phone"), short: planDrawing(model, "short") }), [model]);
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
  const [active, setActive] = useState<string | null>(null);
  const [pan, setPan] = useState(model.focus.start);
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
    const layout = visibleLayout(rootRef.current);
    const move = model.move;
    const clamp = (p: number) => Math.min(1, Math.max(0, p));
    const mover = layout?.querySelector<HTMLElement>('[data-anim="mover"]');
    if (layout && move && mover) {
      const plan = plans[(layout.dataset.layout as DrawingLayout) ?? "desktop"];
      const shift = ((move.to.start - move.from.start) / Math.max(1, plan.track.end - plan.track.start)) * mover.offsetWidth;
      if (Math.abs(shift) >= 1) return clamp(new DOMMatrixReadOnly(getComputedStyle(mover).transform).m41 / shift);
    }
    const fading = layout?.querySelector<HTMLElement>('[data-anim="mover@1"]');
    if (fading) return clamp(Number.parseFloat(getComputedStyle(fading).opacity));
    const progress = flightAnims.current[0]?.effect?.getComputedTiming().progress;
    const last = running.current;
    return last && typeof progress === "number" ? last.fromP + (last.toP - last.fromP) * progress : 0;
  }, [model.move, plans]);

  // The flight: every keyed element of the visible layout gets its keyframes, one duration, one curve. A new
  // flight first reads where the running one is, then cancels it, in the same frame, so nothing jumps.
  useLayoutEffect(() => {
    if (!flight) {
      cancelAll(flightAnims);
      running.current = null;
      return;
    }
    const fromP = flight.fromP ?? currentP();
    cancelAll(flightAnims);
    const layout = visibleLayout(rootRef.current);
    const plan = layout ? plans[(layout.dataset.layout as DrawingLayout) ?? "desktop"] : null;
    let live = true;
    const done = () => {
      if (live) settle(flight);
    };
    if (!layout || !plan || prefersReducedMotion() || Math.abs(flight.toP - fromP) < 1e-6) {
      void Promise.resolve().then(done);
      return () => {
        live = false;
      };
    }
    const frames = flightKeyframes(model, plan, fromP, flight.toP);
    const { duration } = retarget(fromP, flight.toP);
    const animations: Animation[] = [];
    for (const element of layout.querySelectorAll<HTMLElement | SVGElement>("[data-anim]")) {
      const list = frames[element.dataset.anim ?? ""];
      if (list) animations.push(element.animate(list, { duration, easing: EASE_MOVE, fill: "forwards" }));
    }
    flightAnims.current = animations;
    running.current = { fromP, toP: flight.toP };
    Promise.all(animations.map((animation) => animation.finished)).then(done, () => {});
    return () => {
      live = false;
    };
  }, [flight, model, plans, settle, currentP]);

  // Tags and names that differ between the views swap as the drawing settles: out fades, in fades in.
  useLayoutEffect(() => {
    cancelAll(swapAnims);
    if (!swap) return;
    const layout = visibleLayout(rootRef.current);
    if (!layout) return;
    const timing = { duration: TAG_MS, easing: EASE_OUT, fill: "both" as const };
    const animations = [
      ...[...layout.querySelectorAll<HTMLElement>('[data-swap="out"]')].map((element) => element.animate([{ opacity: 1 }, { opacity: 0 }], timing)),
      ...[...layout.querySelectorAll<HTMLElement>('[data-swap="in"]')].map((element) => element.animate([{ opacity: 0 }, { opacity: 1 }], timing)),
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

  // The phone's detail window: slide from where it is to the new place, or jump under reduced motion.
  useLayoutEffect(() => {
    const from = panFrom.current;
    panFrom.current = null;
    if (!from) return;
    panAnims.current = from.map(([element, transform]) =>
      element.animate([{ transform }, { transform: element.style.transform }], { duration: PAN_MS, easing: EASE_MOVE }),
    );
  }, [pan]);

  const panTo = useCallback(
    (minute: number) => {
      const track = plans.phone.track;
      const length = model.focus.end - model.focus.start;
      const next = Math.min(Math.max(track.start, track.end - length), Math.max(track.start, minute));
      if (Math.abs(next - pan) < 0.01) return;
      const layout = visibleLayout(rootRef.current);
      const elements = layout ? [...layout.querySelectorAll<HTMLElement>("[data-pan-track], [data-bracket]")] : [];
      const from = elements.map((element): [HTMLElement, string] => [element, getComputedStyle(element).transform]);
      cancelAll(panAnims);
      panFrom.current = prefersReducedMotion() ? null : from;
      setPan(next);
    },
    [model.focus, pan, plans.phone.track],
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

  const shown: GraphView = flight ? flight.target : drawn;
  const { move } = model;
  const description = [keyLine(model), move ? `${move.label}.` : null, move ? sideEffectText(move) : null].filter(Boolean).join(" ");

  const ctx: Ctx = {
    model,
    uid,
    drawn,
    shown,
    flight,
    swap,
    pan,
    note: hover ?? pin,
    active,
    onLineFocus: (layout, key) => {
      setActive(key);
      if (layout === "desktop") return;
      const line = plans[layout].views[shown].lines.find((item) => item.key === key);
      const length = model.focus.end - model.focus.start;
      if (line && (line.mid < pan || line.mid > pan + length)) panTo(line.mid - length / 2);
    },
    onLineKey: (layout, key, event) => {
      const order = plans[layout].views[shown].lines.slice().sort((a, b) => a.thread.rank - b.thread.rank).map((line) => line.key);
      const { focus: next, unpin } = lineKeyAction(order, key, event.key);
      if (unpin) {
        setPin(null);
        event.stopPropagation();
        return;
      }
      if (!next) return;
      event.preventDefault();
      setActive(next);
      if (pin?.kind === "line") setPin({ kind: "line", key: next });
      const target = event.currentTarget.closest("[data-layout]")?.querySelector<HTMLElement>(`[data-hit="${next}"]`);
      target?.focus({ preventScroll: true });
    },
    onLineClick: (key) => {
      setActive(key);
      setPin((current) => (current?.kind === "line" && current.key === key ? null : { kind: "line", key }));
    },
    onHover: (note) => setHover(note),
    onSetClick: (id) => setPin((current) => (current?.kind === "set" && current.id === id ? null : { kind: "set", id })),
    onStripTap: (minute) => {
      const lines = plans.phone.views[shown].lines;
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
        if (event.key === "Escape" && pin) setPin(null);
      }}
    >
      <p id={`${uid}-title`} className="sr-only">
        {drawingTitle(model, view)}
      </p>
      <p id={`${uid}-desc`} className="sr-only">
        {description}
      </p>
      {LAYOUTS.map((layout) => (
        <Drawing key={layout} layout={layout} plan={plans[layout]} wide={layout === "desktop" ? null : wides[layout]} ctx={ctx} />
      ))}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

type Ctx = {
  model: DayGraphModel;
  uid: string;
  drawn: GraphView;
  shown: GraphView;
  flight: Flight | null;
  swap: Swap | null;
  pan: number;
  note: Note | null;
  active: string | null;
  onLineFocus: (layout: DrawingLayout, key: string) => void;
  onLineKey: (layout: DrawingLayout, key: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  onLineClick: (key: string) => void;
  onHover: (note: Note | null) => void;
  onSetClick: (id: string) => void;
  onStripTap: (minute: number) => void;
};

/** One layout: the stage names, the time track (panning on a phone), the overview strip and the note layer. */
function Drawing({ layout, plan, wide, ctx }: { layout: DrawingLayout; plan: LayoutPlan; wide: LayoutPlan | null; ctx: Ctx }) {
  const { model } = ctx;
  const height = drawingHeight(model, layout);
  const top = layout === "phone" ? DETAIL_TOP : 0;
  const panned = layout !== "desktop";
  const length = Math.max(1, plan.track.end - plan.track.start);
  const focus = Math.max(1, model.focus.end - model.focus.start);
  const trackStyle: CSSProperties = panned
    ? { width: pct((length / focus) * 100), transform: `translateX(-${pct(((ctx.pan - plan.track.start) / length) * 100)})` }
    : {};
  return (
    <div data-layout={layout} className={LAYOUT_CLASS[layout]} style={{ height }}>
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
          <Marks layout={layout} plan={plan} wide={wide} ctx={ctx} />
          <Hits layout={layout} plan={plan} ctx={ctx} />
        </div>
      </div>
      {layout === "phone" ? <Strip plan={plan} ctx={ctx} /> : null}
      <NoteLayer layout={layout} plan={plan} ctx={ctx} top={top} height={height} />
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
 * A set's bar: white with a hairline edge and 6px corners; an unscored set is muted with no edge. Its name and
 * lock are drawn over the lines that cross it, each glyph ringed in the bar's own fill, so a line passes behind a
 * name and never through it.
 */
function SetBar({
  set,
  span,
  track,
  scale,
  style,
  showName,
  wash,
  ctx,
  className,
}: {
  set: DayGraphSet;
  span: Span;
  track: Span;
  scale: number;
  style: CSSProperties;
  showName: boolean;
  wash: { key?: string; transform: string } | null;
  ctx: Ctx;
  className?: string;
}) {
  const roomy = holdsName(set, span, scale);
  return (
    <div
      data-set={set.actId}
      className={cn(
        "pointer-events-auto absolute overflow-hidden rounded-xs",
        set.unscored ? "bg-muted text-muted-foreground [--halo:var(--muted)]" : "border border-border-strong bg-card [--halo:var(--card)]",
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
      {set.locked || (showName && roomy) ? (
        <span className="absolute inset-y-0 right-[5px] left-[5px] z-[1] flex min-w-0 items-center gap-1 [paint-order:stroke_fill] [-webkit-text-stroke:4px_var(--halo)]">
          {set.locked ? (
            <span title="Locked: this set stays put" className="relative flex shrink-0">
              <Lock aria-hidden="true" className="absolute inset-0 size-3 fill-(--halo) text-(--halo)" strokeWidth={7} />
              <Lock aria-hidden="true" className="relative size-3" strokeWidth={2.25} />
            </span>
          ) : null}
          {showName && roomy ? <span className="min-w-0 truncate font-medium">{set.name}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/** A name or tag at its spot; `shift` minutes are taken off its anchor when it rides the mover's layer. */
function SpotLabel({
  spot,
  text,
  track,
  shift = 0,
  className,
  data,
}: {
  spot: Spot;
  text: string;
  track: Span;
  shift?: number;
  className?: string;
  data?: Record<string, string>;
}) {
  const style: CSSProperties = {
    left: `calc(${pct(trackPct(track, spot.anchor - shift))} + ${spot.dx}px)`,
    top: spot.top,
    transform: spot.align === "end" ? "translateX(-100%)" : undefined,
    width: spot.cut ? `max(0px, calc(${spanPct(track, spot.cut)} - ${spot.dx + NAME_INSET}px))` : undefined,
  };
  return (
    <span
      {...data}
      className={cn("pointer-events-none absolute whitespace-nowrap font-semibold", spot.plate && "bg-background px-0.5", spot.cut && "truncate", className)}
      style={style}
    >
      {text}
    </span>
  );
}

/** A line between the two sets of a clash: its paper casing, its stroke and an end dot on each set's edge. */
function LineMark({
  line,
  synthetic,
  transform,
  animKey,
  opacity,
}: {
  line: PlanLine;
  synthetic: boolean;
  transform: string;
  animKey?: string;
  opacity?: number;
}) {
  const height = line.bottom - line.top;
  const color = lineColor(line.thread.lit, synthetic, line.thread.ranked);
  const dot = line.thread.lit ? 8 : 6;
  const dotStyle: CSSProperties = { width: dot, height: dot, marginLeft: -dot / 2, marginTop: -dot / 2, borderRadius: "50%", background: color };
  return (
    <div
      data-thread={line.thread.rank}
      data-lit={line.thread.lit ? "" : undefined}
      data-unranked={line.thread.ranked ? undefined : ""}
      data-anim={animKey}
      className="pointer-events-none absolute inset-x-0"
      style={{ top: line.top, height, transform, opacity }}
    >
      <svg aria-hidden="true" focusable="false" width={24} height={height} className="absolute top-0 -left-3 overflow-visible">
        {line.thread.lit ? null : (
          <line data-casing="" x1={12} x2={12} y1={0} y2={height} stroke="var(--background)" strokeWidth={line.width + 2 * CASING} />
        )}
        <line x1={12} x2={12} y1={0} y2={height} stroke={color} strokeWidth={line.width} />
      </svg>
      <span data-end-dot="" className="absolute top-0 left-0" style={dotStyle} />
      <span data-end-dot="" className="absolute left-0" style={{ ...dotStyle, top: height }} />
    </div>
  );
}

/** The flight's form of a window: a stationary fill revealed between a left and a right edge that only translate. */
function MovingWindow({
  id,
  edges,
  window,
  fills,
  dashed,
  initial,
  groupKey,
  opacity,
}: {
  id: string;
  edges: string;
  window: PlanWindow;
  fills: string[];
  dashed: boolean;
  initial: { left: string; right: string };
  groupKey?: string;
  opacity?: number;
}) {
  const { top, bottom } = window;
  const r = Math.min(MARK_RADIUS, (bottom - top) / 2);
  const s = 0.75;
  const leftMask = `M ${r} ${top} H 100000 V ${bottom} H ${r} A ${r} ${r} 0 0 1 0 ${bottom - r} V ${top + r} A ${r} ${r} 0 0 1 ${r} ${top} Z`;
  const rightMask = `M -100000 ${top} H ${-r} A ${r} ${r} 0 0 1 0 ${top + r} V ${bottom - r} A ${r} ${r} 0 0 1 ${-r} ${bottom} H -100000 Z`;
  const stroke = { fill: "none", stroke: "var(--primary)", strokeWidth: 1.5, strokeDasharray: "4 3" };
  return (
    <g data-anim={groupKey} style={{ opacity }}>
      <clipPath id={`${id}-l`}>
        <path data-anim={`${edges}:L`} d={leftMask} style={{ transform: initial.left }} />
      </clipPath>
      <clipPath id={`${id}-r`}>
        <path data-anim={`${edges}:R`} d={rightMask} style={{ transform: initial.right }} />
      </clipPath>
      {dashed ? (
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
          {dashed ? (
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
 * Everything drawn on the track, in paint order: windows (behind the bars), the ghost, the bars and the
 * mover, the lines with their casings and end dots, then the names and tags on their paper plates.
 */
function Marks({ layout, plan, wide, ctx }: { layout: DrawingLayout; plan: LayoutPlan; wide: LayoutPlan | null; ctx: Ctx }) {
  const { model, flight, drawn, swap } = ctx;
  const { track, scale } = plan;
  const move = model.move;
  const bar = LAYOUT[layout].bar;
  const flying = flight !== null;
  const p = flight ? flight.toP : viewP(model, drawn);
  const restView = flight ? flight.from : drawn;
  const pub = plan.views.published;
  const moved = plan.views.moved;
  const rest = plan.views[drawn];
  const crossfade = Boolean(move && move.from.stageIndex !== move.to.stageIndex);
  const hatchId = `${ctx.uid}-${layout}-hatch`;
  const setById = new Map(model.sets.map((set) => [set.actId, set]));
  const partner = move ? setById.get(move.partnerId) : undefined;
  const partnerSpan = partner ? { start: partner.start, end: partner.end } : null;
  const lit = model.threads.find((thread) => thread.lit);
  const shiftOf = (view: GraphView) => (move ? moverAt(move, viewP(model, view)).start - move.from.start : 0);

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
            <rect {...windowRect(rest.hatch)} rx={MARK_RADIUS} fill={`url(#${hatchId})`} />
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

  // --- lines
  type Drawn = { line: PlanLine; key: string; transform: string; opacity?: number };
  const lines: Drawn[] = [];
  if (!flying) {
    for (const line of rest.lines) lines.push({ line, key: `line:${line.key}`, transform: lineTransform(track, line.mid, line.off) });
  } else if (move) {
    const keys = new Set([...pub.lines.map((line) => line.key), ...moved.lines.map((line) => line.key)]);
    for (const key of keys) {
      const a = pub.lines.find((line) => line.key === key);
      const b = moved.lines.find((line) => line.key === key);
      const base = (a ?? b) as PlanLine;
      const offAt = lerp(a?.off ?? b?.off ?? 0, b?.off ?? a?.off ?? 0, p);
      if (!base.moving) {
        lines.push({ line: base, key: `line:${key}`, transform: lineTransform(track, base.mid, offAt) });
        continue;
      }
      const otherId = base.thread.aId === move.actId ? base.thread.bId : base.thread.aId;
      const other = setById.get(otherId);
      if (!other) continue;
      const otherSpan = { start: other.start, end: other.end };
      const here = moverAt(move, p);
      const mid = (Math.max(here.start, other.start) + Math.min(here.end, other.end)) / 2;
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

  // --- names and tags: the resting view's while in flight (they swap when it settles). A phone narrower than
  // 360px has its own placements where they differ, and CSS shows one set or the other.
  const labelView = flying ? restView : drawn;
  type Item = { key: string; id: string; text: string; spot: Spot; mover: boolean; tag: boolean; sig: string; className?: string };
  const itemsOf = (source: LayoutPlan, view: GraphView): Item[] => [
    ...Object.entries(source.views[view].labels).map(([id, spot]): Item => {
      const text = setById.get(id)?.name ?? "";
      const isMover = id === move?.actId;
      // The mover's name is known by where it sits on its bar, which travels; any other by where it sits.
      const sig = isMover ? `mover|${spotSignature(spot, text, spot.anchor - shiftOf(view))}` : `${id}|${spotSignature(spot, text, spot.anchor)}`;
      return { key: `label:${id}`, id, text, spot, mover: isMover, tag: false, sig };
    }),
    ...source.views[view].tags.map(
      (tag): Item => ({ key: `tag:${tag.key}`, id: tag.key, text: tag.text, spot: tag.spot, mover: false, tag: true, sig: `tag|${spotSignature(tag.spot, tag.text, tag.spot.anchor)}` }),
    ),
  ];
  const itemsAt = (view: GraphView): Item[] => {
    if (!wide) return itemsOf(plan, view);
    const regular = itemsOf(wide, view);
    const narrow = itemsOf(plan, view);
    const narrowSigs = new Set(narrow.map((item) => item.sig));
    const regularSigs = new Set(regular.map((item) => item.sig));
    return [
      ...regular.map((item) => (narrowSigs.has(item.sig) ? item : { ...item, key: `${item.key}:wide`, className: "max-[360px]:hidden" })),
      ...narrow.filter((item) => !regularSigs.has(item.sig)).map((item) => ({ ...item, key: `${item.key}:narrow`, className: "hidden max-[360px]:block" })),
    ];
  };
  const identity = (item: Item) => `${item.sig}|${item.className ?? ""}`;
  const showing = itemsAt(labelView);
  let incoming = new Set<string>();
  let outgoing: Item[] = [];
  if (swap && !flying) {
    const before = itemsAt(swap.from);
    const beforeIds = new Set(before.map(identity));
    const afterIds = new Set(showing.map(identity));
    incoming = new Set(showing.filter((item) => !beforeIds.has(identity(item))).map(identity));
    outgoing = before.filter((item) => !afterIds.has(identity(item)));
  }
  const renderItem = (item: Item, shift: number, mark: "in" | "out" | null) => (
    <SpotLabel
      key={`${mark ?? "on"}-${item.key}-${item.text}`}
      spot={item.spot}
      text={item.text}
      track={track}
      shift={shift}
      className={cn(item.tag && "text-primary", item.className)}
      data={{ [item.tag ? "data-shared-tag" : "data-label"]: item.id, ...(mark ? { "data-swap": mark } : {}) }}
    />
  );
  const fixedItems = showing.filter((item) => !item.mover);
  const moverItems = showing.filter((item) => item.mover);
  const leavingMover = outgoing.filter((item) => item.mover);
  const leavingFixed = outgoing.filter((item) => !item.mover);

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

      {still.map((item) => (
        <SetBar
          key={item.set.actId}
          set={item.set}
          span={item.span}
          track={track}
          scale={scale}
          style={{ top: item.top, height: bar }}
          showName={!item.set.featured}
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
                scale={scale}
                style={{ top: 0, height: bar }}
                showName={false}
                wash={washFor(mover, fromSpan)}
                ctx={ctx}
              />
            </div>
          ))
        : null}

      {lines.map((item) => (
        <LineMark key={item.key} line={item.line} synthetic={model.synthetic} transform={item.transform} animKey={item.key} opacity={item.opacity} />
      ))}

      {fixedItems.map((item) => renderItem(item, 0, incoming.has(identity(item)) ? "in" : null))}
      {move && moverItems.length
        ? moverCopies
            .filter((copy) => !crossfade || copy.key === (labelView === "moved" ? "mover@1" : "mover@0"))
            .map((copy) => (
              <div
                key={`label-${copy.key}`}
                data-anim={copy.key}
                className="pointer-events-none absolute inset-0"
                style={{ transform: moverTransform(track, move, p), opacity: copy.opacity }}
              >
                {moverItems.map((item) => renderItem(item, shiftOf(labelView), incoming.has(identity(item)) ? "in" : null))}
              </div>
            ))
        : null}
      {move && swap && leavingMover.length ? (
        // The mover's old name rides the mover's layer, now at the new view's place, so it stays on its bar.
        <div className="pointer-events-none absolute inset-0" style={{ transform: moverTransform(track, move, p) }}>
          {leavingMover.map((item) => renderItem(item, shiftOf(swap.from), "out"))}
        </div>
      ) : null}
      {leavingFixed.map((item) => renderItem(item, 0, "out"))}
    </div>
  );
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/**
 * The lines' hit areas: one tab stop for the layout, each a 46px target with 10px corners (at least 44px after
 * any rounding) that moves with its line. They sit over the names, so a focus ring is never hidden by one.
 */
function Hits({ layout, plan, ctx }: { layout: DrawingLayout; plan: LayoutPlan; ctx: Ctx }) {
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
  const setById = new Map(model.sets.map((set) => [set.actId, set]));
  return (
    <div className="pointer-events-none absolute inset-0 z-[2]">
      {order.map((line) => {
        let transform = lineTransform(plan.track, line.mid, line.off);
        if (flight && move && line.moving) {
          const otherId = line.thread.aId === move.actId ? line.thread.bId : line.thread.aId;
          const other = setById.get(otherId);
          if (other) {
            const here = moverAt(move, p);
            transform = lineTransform(plan.track, (Math.max(here.start, other.start) + Math.min(here.end, other.end)) / 2, line.off);
          }
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
              onFocus={() => ctx.onLineFocus(layout, line.key)}
              onKeyDown={(event) => ctx.onLineKey(layout, line.key, event)}
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

/**
 * The phone's overview: every stage and every line of the day at 1px, and a bracket on the detail window.
 * A tap selects the nearest drawn line and slides the detail to it; nothing in it takes focus.
 */
function Strip({ plan, ctx }: { plan: LayoutPlan; ctx: Ctx }) {
  const { model, flight, drawn } = ctx;
  const { track } = plan;
  const move = model.move;
  const stages = Math.max(1, model.stages.length);
  const pitch = LAYOUT.phone.overview / stages;
  const height = Math.max(2, pitch - 1);
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
        top: upper * pitch + height,
        bottom: lower * pitch,
        animKey: flying && moving ? `sline:${key}${copy}` : undefined,
        opacity,
      });
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
  const mark = (set: DayGraphSet, span: Span, top: number) => (
    <span
      key={set.actId}
      className={cn("absolute rounded-xs", set.unscored ? "bg-muted" : "border border-border-strong bg-card")}
      style={{ left: pct(trackPct(track, span.start)), width: spanPct(track, span), top, height }}
    />
  );

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    ctx.onStripTap(track.start + ((event.clientX - box.left) / box.width) * length);
  };

  return (
    <div
      data-strip=""
      aria-hidden="true"
      className="absolute top-0 right-0 cursor-pointer [overflow-x:clip]"
      style={{ left: GUTTER.phone, height: LAYOUT.phone.overview }}
      onClick={onClick}
    >
      {model.sets.filter((set) => set.actId !== move?.actId).map((set) => mark(set, { start: set.start, end: set.end }, set.stageIndex * pitch))}
      {moverSet && move
        ? moverRows.map((row) => (
            <div
              key={row.key}
              data-anim={row.key}
              className="absolute inset-x-0 top-0"
              style={{ transform: moverTransform(track, move, p), opacity: row.opacity }}
            >
              {mark(moverSet, { start: move.from.start, end: move.from.end }, row.stage * pitch)}
            </div>
          ))
        : null}
      {strokes.map((stroke) => (
        <div
          key={stroke.key}
          data-anim={stroke.animKey}
          className="absolute inset-x-0"
          style={{ top: stroke.top, height: Math.max(0, stroke.bottom - stroke.top), transform: lineTransform(track, stroke.mid, 0), opacity: stroke.opacity }}
        >
          <span className="absolute inset-y-0 left-0 w-px" style={{ marginLeft: -0.5, background: lineColor(stroke.thread.lit, model.synthetic, stroke.thread.ranked) }} />
        </div>
      ))}
      <span
        data-bracket=""
        className="absolute -top-0.5 -bottom-0.5 left-0 rounded-xs border-2 border-foreground"
        style={{ width: pct((focus / length) * 100), transform: `translateX(${pct(((ctx.pan - track.start) / focus) * 100)})` }}
      />
      {/* The tap target reaches 44px tall over the gap and the detail's axis, which take no presses. */}
      <span className="absolute inset-x-0 top-0 h-11" />
    </div>
  );
}

/**
 * The note for the line or set under the pointer, or pinned by a tap, Enter or Space: above or below it, on the
 * side with more room, and kept inside the drawing's box, so it covers nothing under or over the drawing. An
 * overlay that moves nothing on the page. A phone's note may span the stage names, so it wraps to fewer lines.
 */
function NoteLayer({ layout, plan, ctx, top, height }: { layout: DrawingLayout; plan: LayoutPlan; ctx: Ctx; top: number; height: number }) {
  const { model, note, shown } = ctx;
  if (!note) return null;
  const view = plan.views[shown];
  const focus = Math.max(1, model.focus.end - model.focus.start);
  let text = "";
  let minute = 0;
  let off = 0;
  let upper = 0;
  let lower = 0;
  if (note.kind === "line") {
    const line = view.lines.find((item) => item.key === note.key);
    if (!line) return null;
    text = threadNote(model, line.thread, shown);
    minute = line.mid;
    off = line.off;
    upper = line.top;
    lower = line.bottom;
  } else {
    const item = view.bars.find((entry) => entry.set.actId === note.id);
    if (!item) return null;
    text = setNote(model, item.set, shown);
    minute = (item.span.start + item.span.end) / 2;
    upper = item.top;
    lower = item.top + LAYOUT[layout].bar;
  }
  const desktop = layout === "desktop";
  // Where the mark is across the note's column: the track on a desktop; the whole box, stage names included, on a phone.
  const anchor = desktop
    ? `${pct(trackPct(plan.track, minute))} + ${off}px`
    : `${GUTTER[layout]}px + (100% - ${GUTTER[layout]}px) * ${Math.round(((minute - ctx.pan) / focus) * 10000) / 10000} + ${off}px`;
  const width = desktop ? "min(20rem, 100%)" : "min(22rem, 100%)";
  const { above, offset } = noteSide(top + upper, top + lower, height);
  const gap = <span aria-hidden="true" className="min-h-0 shrink" style={{ flexBasis: offset }} />;
  return (
    <div
      className={cn("pointer-events-none absolute inset-y-0 right-0 flex flex-col", above ? "justify-end" : "justify-start")}
      style={{ left: desktop ? GUTTER[layout] : 0 }}
    >
      {above ? null : gap}
      <div
        key={`${note.kind}-${note.kind === "line" ? note.key : note.id}-${shown}`}
        data-thread-note={note.kind}
        className="relative z-10 shrink-0 rounded-md border border-border bg-popover px-3 py-2 text-[13px] leading-[18px] text-foreground transition-[opacity,translate] duration-(--dur-feedback) ease-(--ease-out) starting:translate-y-[3px] starting:opacity-0 motion-reduce:transition-none"
        style={{ width, marginLeft: `clamp(0px, calc(${anchor} - ${width} / 2), calc(100% - ${width}))` }}
      >
        {text}
      </div>
      {above ? gap : null}
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
