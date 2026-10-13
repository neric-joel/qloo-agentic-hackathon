"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import { INTRO_DONE_EVENT } from "@/lib/use-in-view";

/**
 * The words that roll through, each with its window in ms from first paint (it is in from the bottom by
 * a third of the way in and leaves out the top as the next arrives). They say what the product looks at,
 * in order; no figures and no names, so nothing here can be read as data.
 */
export const INTRO_WORDS = [
  { word: "Stages", from: 160, to: 640 },
  { word: "Sets", from: 640, to: 1120 },
  { word: "Overlaps", from: 1120, to: 1600 },
  { word: "Clashes", from: 1600, to: 2160 },
] as const;

/** The closing question, as its two lines. */
export const INTRO_LINE = ["Which one is", "worth moving?"] as const;

/** The quiet corner marks: the name, and how to skip (a touch screen gets its own wording). */
export const INTRO_MARKS = {
  name: "Clash Control",
  skip: "Click or press any key to skip",
  skipTouch: "Tap to skip",
} as const;

/** The overlay's own CSS timeline, in ms from first paint (`globals.css`, `.cc-intro`). */
export const INTRO_TIMELINE = {
  /** The vermilion line draws where the question will open. */
  line: 2150,
  /** The line splits and the question opens out from it. */
  open: 2300,
  /** A vermilion rule swipes in under the question's second line. */
  rule: 2700,
  /** The overlay starts to lift; its curved lower edge flattens as it goes. */
  lift: 3250,
  /** The overlay is gone. */
  end: 3850,
} as const;

/** How long the client waits for the overlay's own end before it calls the intro done anyway. */
export const INTRO_FALLBACK_MS = 4200;

/**
 * The opening reveal (`html[data-intro="play"]`, set by the head script in `app/layout.tsx` on a first
 * visit to the home page): on a warm near-black sheet, with the name and how to skip in the corners and
 * a vermilion progress rule along its foot, a vermilion dot and big condensed words roll through like a
 * reel (stages, sets, overlaps, clashes; the last hit by a mis-registered vermilion copy), a vermilion
 * line draws and splits open on the question, a rule swipes in under it, then the sheet lifts with a
 * curved, vermilion-edged lower edge that flattens as it goes, and the page under it rises into place. The words are generated content (`content: attr(...)`), so the page's
 * text never includes them. The whole timeline is CSS on one clock, so it ends hidden even if this
 * component never runs. While it shows it takes every pointer event, so a tap lands on the curtain and
 * not on a control under it; the head script (from before hydration) turns that tap, a key or a wheel
 * into a skip. This part marks it done at its own end, which starts the hero receipt. Without the
 * attribute (no JavaScript, reduced motion, a deep link, a second page, print) the overlay is
 * `display: none`.
 */
export function IntroReveal() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const overlay = ref.current;
    if (root.dataset.intro !== "play" || !overlay) return;

    const lift = overlay
      .getAnimations?.()
      .find((animation) => (animation as CSSAnimation).animationName === "cc-intro-lift");
    // Ends it once: the head script may already have (a tap, key or wheel), and then this only stops.
    const finish = () => {
      stop();
      if (root.dataset.intro !== "play") return;
      root.dataset.intro = "done";
      window.dispatchEvent(new Event(INTRO_DONE_EVENT));
    };
    const onEnd = (event: AnimationEvent) => {
      if (event.target === overlay && event.animationName === "cc-intro-lift") finish();
    };
    // At the overlay's own end, or the fallback if its animation cannot be found or never ends.
    const elapsed = Number(lift?.currentTime ?? 0);
    const remaining = lift ? Math.max(0, INTRO_TIMELINE.end - elapsed) + 100 : INTRO_FALLBACK_MS;
    const timer = window.setTimeout(finish, Math.min(remaining, INTRO_FALLBACK_MS));
    overlay.addEventListener("animationend", onEnd);
    window.addEventListener(INTRO_DONE_EVENT, stop);
    function stop() {
      window.clearTimeout(timer);
      overlay?.removeEventListener("animationend", onEnd);
      window.removeEventListener(INTRO_DONE_EVENT, stop);
    }
    // Hydrated after the overlay had already gone (a slow load): it is over.
    if (lift?.playState === "finished") finish();
    return stop;
  }, []);

  const last = INTRO_WORDS.length - 1;
  return (
    <div ref={ref} className="cc-intro" aria-hidden="true">
      <div className="cc-intro-stage">
        <div className="cc-intro-cycle">
          <span className="cc-intro-dot" />
          <span className="cc-intro-words">
            {INTRO_WORDS.map(({ word, from, to }, i) => (
              <span
                key={word}
                className={i === last ? "cc-iw cc-iw-last" : "cc-iw"}
                data-w={word}
                style={{ "--d": `${from}ms`, "--t": `${to - from}ms` } as CSSProperties}
              />
            ))}
          </span>
        </div>
        <div className="cc-intro-final">
          <span className="cc-if-text" data-a={INTRO_LINE[0]} data-b={INTRO_LINE[1]} />
          <span className="cc-if-edges">
            <span className="cc-if-l" />
            <span className="cc-if-r" />
          </span>
          <span className="cc-if-rule" />
        </div>
      </div>
      <span className="cc-intro-mark" data-t={INTRO_MARKS.name} />
      <span className="cc-intro-skip" data-t={INTRO_MARKS.skip} data-touch={INTRO_MARKS.skipTouch} />
      <span className="cc-intro-progress" />
      <svg className="cc-intro-edge" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        <g className="cc-ie-bend">
          <path className="cc-ie-fill" d="M0 0H100Q50 200 0 0Z" />
          <path className="cc-ie-line" d="M100 0Q50 200 0 0" />
        </g>
      </svg>
    </div>
  );
}
