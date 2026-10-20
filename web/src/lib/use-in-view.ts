import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Scroll-triggered motion that plays once per page load. Every piece of motion on the site is drawn
 * at its final state in the server HTML; these hooks only say when a component may play its
 * sequence. Under reduced motion, without IntersectionObserver, or on the server they say nothing
 * (the component keeps its final state), so no reader ever waits on them.
 */

/** Intersection ratios the observers report at, so a tall or clipped element is still measured. */
const STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

/** How far below the viewport an element counts as "about to show", so it can take its start frame unseen. */
const NEAR_MARGIN = "0px 0px 50% 0px";

/** True when the browser can observe and the visitor has not asked for reduced motion. */
export function motionAllowed(): boolean {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return false;
  return !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/** The parts of an IntersectionObserverEntry that `isShown` reads. */
type Seen = {
  isIntersecting: boolean;
  intersectionRect: { height: number };
  boundingClientRect: { height: number };
  rootBounds: { height: number } | null;
};

/**
 * Whether an observation shows enough of the element: this fraction of its height, or, for an
 * element taller than the viewport can show at that fraction, this fraction of the viewport's height.
 * Heights rather than areas, so a board clipped sideways by a phone scroller still counts.
 */
export function isShown(entry: Seen, threshold: number, viewportHeight = 0): boolean {
  if (!entry.isIntersecting) return false;
  const visible = entry.intersectionRect.height;
  const own = entry.boundingClientRect.height;
  if (own > 0 && visible / own >= threshold) return true;
  const viewport = entry.rootBounds?.height || viewportHeight;
  return viewport > 0 && visible >= threshold * viewport;
}

function viewportHeight(): number {
  return typeof window === "undefined" ? 0 : window.innerHeight;
}

export type InViewOptions = {
  /** How much must show (see `isShown`). Default 0.5. */
  threshold?: number;
  /** Stay true after the first time (default). With false the value follows the element in and out. */
  once?: boolean;
  /** Report in view after this many ms if no observation has, for a piece that must play (the hero). */
  fallbackMs?: number | null;
  rootMargin?: string;
  /** False keeps the hook idle. */
  enabled?: boolean;
};

/**
 * True once the element behind `ref` shows (`threshold`), or when `fallbackMs` runs out first. Stays
 * false on the server, under reduced motion and without IntersectionObserver. The element must be
 * in the page when the component mounts (or when `enabled` turns true).
 */
export function useInView(
  ref: RefObject<Element | null>,
  { threshold = 0.5, once = true, fallbackMs = null, rootMargin = "0px", enabled = true }: InViewOptions = {},
): boolean {
  const [inView, setInView] = useState(false);
  const latched = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || (once && latched.current) || !motionAllowed()) return;
    let timer = 0;
    const report = (shown: boolean) => {
      if (once && latched.current) return;
      setInView(shown);
      if (shown && once) {
        latched.current = true;
        observer.disconnect();
        window.clearTimeout(timer);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) report(isShown(entry, threshold, viewportHeight()));
      },
      { threshold: STEPS, rootMargin },
    );
    observer.observe(element);
    if (fallbackMs !== null) timer = window.setTimeout(() => report(true), fallbackMs);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [ref, threshold, once, fallbackMs, rootMargin, enabled]);

  return inView;
}

/**
 * Where a scroll-triggered piece is. "still": draw the final state and play nothing (the server, reduced
 * motion, the element was already on screen at load, or it waited too long). "wait": it is about to
 * scroll in, so draw the start frame (it is still out of sight). "play": run the sequence once.
 */
export type RevealPhase = "still" | "wait" | "play";

export type RevealOptions = {
  /** How much must show before it plays (see `isShown`). Default 0.5. */
  threshold?: number;
  /** How long the start frame may hold before it gives up and shows the final state. Default 1500. */
  fallbackMs?: number;
  /** Called with each new phase; `order` counts the pieces that start playing in the same frame. */
  onPhase: (phase: RevealPhase, order: number) => void;
};

type Watch = {
  state: "start" | "idle" | "wait";
  near: boolean;
  timer: number;
  fallbackMs: number;
  onPhase: RevealOptions["onPhase"];
};

type Observers = { seen: IntersectionObserver; near: IntersectionObserver; watches: Map<Element, Watch> };

/** One pair of observers per threshold, shared by every piece that uses it (all the meters on a page). */
const shared = new Map<number, Observers>();

function observersFor(threshold: number): Observers {
  const existing = shared.get(threshold);
  if (existing) return existing;
  const watches = new Map<Element, Watch>();

  const end = (target: Element, watch: Watch, phase: RevealPhase, order = 0) => {
    window.clearTimeout(watch.timer);
    watches.delete(target);
    seen.unobserve(target);
    near.unobserve(target);
    watch.onPhase(phase, order);
  };
  const hold = (target: Element, watch: Watch) => {
    watch.state = "wait";
    watch.onPhase("wait", 0);
    watch.timer = window.setTimeout(() => {
      if (watches.get(target) === watch && watch.state === "wait") end(target, watch, "still");
    }, watch.fallbackMs);
  };

  const seen = new IntersectionObserver(
    (entries) => {
      let order = 0;
      for (const entry of entries) {
        const watch = watches.get(entry.target);
        if (!watch) continue;
        if (watch.state === "start") {
          // Already on screen when it arrived: it stays still, so a first screen never animates on its own.
          if (entry.isIntersecting) {
            end(entry.target, watch, "still");
            continue;
          }
          watch.state = "idle";
          if (watch.near) hold(entry.target, watch);
          continue;
        }
        if (isShown(entry, threshold, viewportHeight())) end(entry.target, watch, "play", order++);
      }
    },
    { threshold: STEPS },
  );
  const near = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const watch = watches.get(entry.target);
        if (!watch) continue;
        watch.near = entry.isIntersecting;
        if (watch.state === "idle" && watch.near) hold(entry.target, watch);
      }
    },
    { rootMargin: NEAR_MARGIN },
  );

  const created = { seen, near, watches };
  shared.set(threshold, created);
  return created;
}

/**
 * Watches one element for a scroll-triggered piece and reports its phases (see `RevealPhase`). Returns
 * the cleanup. Does nothing (and reports nothing) when motion is not allowed.
 */
export function watchReveal(
  element: Element,
  { threshold = 0.5, fallbackMs = 1500, onPhase }: RevealOptions,
): () => void {
  if (!motionAllowed()) return () => {};
  const { seen, near, watches } = observersFor(threshold);
  const watch: Watch = { state: "start", near: false, timer: 0, fallbackMs, onPhase };
  watches.set(element, watch);
  seen.observe(element);
  near.observe(element);
  return () => {
    if (watches.get(element) !== watch) return;
    window.clearTimeout(watch.timer);
    watches.delete(element);
    seen.unobserve(element);
    near.unobserve(element);
  };
}

/** `watchReveal` for a component: the phase of the element behind `ref`, "still" until it changes. */
export function useReveal(
  ref: RefObject<Element | null>,
  { threshold = 0.5, fallbackMs = 1500, enabled = true }: { threshold?: number; fallbackMs?: number; enabled?: boolean } = {},
): RevealPhase {
  const [phase, setPhase] = useState<RevealPhase>("still");
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    return watchReveal(element, { threshold, fallbackMs, onPhase: (next) => setPhase(next) });
  }, [ref, threshold, fallbackMs, enabled]);
  return phase;
}
