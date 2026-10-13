"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import { INTRO_DONE_EVENT } from "@/lib/use-in-view";

/**
 * The words that roll through, each with its window in ms from first paint (it is in from the bottom by
 * a third of the way in and leaves out the top as the next arrives). They say what the product looks at,
 * in order; no figures and no names, so nothing here can be read as data.
 */
export const INTRO_WORDS = [
  { word: "Sets", from: 60, to: 280 },
  { word: "Overlaps", from: 280, to: 500 },
  { word: "Clashes", from: 500, to: 740 },
] as const;

/** The closing question, as its two lines: the home page's h1 asks it too. */
export const INTRO_LINE = ["Which clash is", "worth moving?"] as const;

/** The quiet corner marks: the name, and how to skip (a touch screen gets its own wording). */
export const INTRO_MARKS = {
  name: "Clash Control",
  skip: "Click or press any key to skip",
  skipTouch: "Tap to skip",
} as const;

/**
 * The overlay's timeline, in ms from first paint: the whole curtain is gone by `end` (under 1.5 s). The
 * shared CSS (`globals.css`, `.cc-intro`) holds the motion; `INTRO_TIMING_CSS` below sets its clock.
 */
export const INTRO_TIMELINE = {
  /** The vermilion line draws where the question will open. */
  line: 720,
  /** The line splits and the question opens out from it. */
  open: 780,
  /** A vermilion rule swipes in under the question's second line. */
  rule: 900,
  /** The overlay starts to lift; its curved lower edge flattens as it goes. */
  lift: 1150,
  /** The overlay is gone. */
  end: 1480,
} as const;

/** How long the client waits for the overlay's own end before it calls the intro done anyway. */
export const INTRO_FALLBACK_MS = 1800;

/** How long a reel word's motion runs: its window is the 71% it holds before the next word arrives. */
function wordDuration(from: number, to: number, last: boolean): number {
  // The last word's keyframes hold for 29% of 760 ms of a 560 ms window in the shared CSS: the same ratio.
  return Math.round(last ? ((to - from) * 760) / 560 : (to - from) / 0.706);
}

/** The visitor has seen the curtain (localStorage), so it plays at most once per visitor, not per tab. */
export const INTRO_SEEN_KEY = "cc.intro.seen";

/**
 * Runs as the overlay is parsed, right after the head script (`app/layout.tsx`) that arms the curtain for
 * a first visit in this tab (`cc.intro.v2` in sessionStorage, which still decides it first): a visitor who
 * has already seen it in another tab or visit gets no curtain, before anything paints; a first one is
 * remembered. Any storage failure leaves the head script's decision as it was.
 */
export const INTRO_ONCE_SCRIPT = [
  "(function(){try{",
  'var d=document.documentElement;if(d.getAttribute("data-intro")!=="play")return;',
  `var l=window.localStorage,k="${INTRO_SEEN_KEY}";`,
  'if(l.getItem(k)){d.removeAttribute("data-intro");return}l.setItem(k,"1")',
  "}catch(e){}})();",
].join("");

const P = 'html[data-intro="play"]';

/**
 * The curtain's clock, under 1.5 s from first paint: it sets the shared CSS's delays and durations to
 * `INTRO_TIMELINE` (same keyframes and easing). The corner marks show from the first frame, so how to
 * skip is readable at once. Reduced motion and print still hide the overlay (`!important` there).
 */
export const INTRO_TIMING_CSS = [
  `${P} .cc-intro,${P} .cc-intro-stage,${P} #main{animation-duration:${INTRO_TIMELINE.end - INTRO_TIMELINE.lift}ms;animation-delay:${INTRO_TIMELINE.lift}ms}`,
  `${P} .cc-intro-mark,${P} .cc-intro-skip{animation:none}`,
  `${P} .cc-intro-dot{animation:cc-i-pop 200ms cubic-bezier(0.34,1.56,0.64,1) 0ms both,` +
    INTRO_WORDS.slice(1)
      .map(({ from }) => `cc-i-beat 160ms cubic-bezier(0.22,1,0.36,1) ${from}ms`)
      .join(",") +
    `,cc-i-out 160ms cubic-bezier(0.65,0,0.35,1) ${INTRO_TIMELINE.line}ms forwards}`,
  `${P} .cc-iw{animation-duration:var(--t)}`,
  `${P} .cc-iw-last::before{animation-duration:200ms;animation-delay:${INTRO_WORDS[INTRO_WORDS.length - 1].from + 120}ms}`,
  `${P} .cc-if-edges{animation-duration:120ms;animation-delay:${INTRO_TIMELINE.line}ms}`,
  `${P} .cc-if-text,${P} .cc-if-l,${P} .cc-if-r{animation-duration:240ms;animation-delay:${INTRO_TIMELINE.open}ms}`,
  `${P} .cc-if-rule{animation-duration:200ms;animation-delay:${INTRO_TIMELINE.rule}ms}`,
  `${P} .cc-intro-progress{animation-duration:${INTRO_TIMELINE.lift}ms,160ms;animation-delay:0ms,${INTRO_TIMELINE.lift}ms}`,
  `${P} .cc-ie-bend{animation-duration:${INTRO_TIMELINE.end - INTRO_TIMELINE.lift - 40}ms;animation-delay:${INTRO_TIMELINE.lift + 40}ms}`,
].join("");

/**
 * The opening reveal (`html[data-intro="play"]`, set by the head script in `app/layout.tsx` on a first
 * visit to the home page, and kept to one showing per visitor by `INTRO_ONCE_SCRIPT`), in under 1.5 s
 * (`INTRO_TIMELINE`): on a warm near-black sheet, with the name and how to skip in the corners from the
 * first frame and a vermilion progress rule along its foot, a vermilion dot and big condensed words roll
 * through like a reel (sets, overlaps, clashes; the last hit by a mis-registered vermilion copy), a vermilion
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
      <script dangerouslySetInnerHTML={{ __html: INTRO_ONCE_SCRIPT }} />
      <style dangerouslySetInnerHTML={{ __html: INTRO_TIMING_CSS }} />
      <div className="cc-intro-stage">
        <div className="cc-intro-cycle">
          <span className="cc-intro-dot" />
          <span className="cc-intro-words">
            {INTRO_WORDS.map(({ word, from, to }, i) => (
              <span
                key={word}
                className={i === last ? "cc-iw cc-iw-last" : "cc-iw"}
                data-w={word}
                style={{ "--d": `${from}ms`, "--t": `${wordDuration(from, to, i === last)}ms` } as CSSProperties}
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
