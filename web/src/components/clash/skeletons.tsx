import { useEffect, useLayoutEffect, type RefObject } from "react";

import { cn } from "@/lib/utils";

/** How many screens a waiting place may reach down from its own top, so an answer that never comes cannot grow the page without end. */
export const HELD_ROOM_SCREENS = 3;

/**
 * How far past the screen's foot a waiting place reaches while it is on screen, as a share of the screen: the browser
 * tells the page about a scroll a frame after it draws it, so the room keeps this much ahead of the visitor.
 */
export const HELD_ROOM_LEAD = 0.25;

/**
 * The height (px) a place that waits for a late answer holds (`useHeldRoom`) while its top (`top`, px from the top of
 * the screen) is above the screen's foot (`fold`): enough to reach `HELD_ROOM_LEAD` of a screen past that foot, so
 * whatever sits under it stays off screen and the answer can take any height without moving anything a visitor sees.
 * It only grows (`current` is what it holds now), never past `HELD_ROOM_SCREENS` screens; a place below the screen
 * keeps what it holds.
 */
export function heldRoomHeight(current: number, top: number, fold: number): number {
  if (!(fold > 0) || top >= fold) return current;
  return Math.max(current, Math.min(Math.ceil(fold * (1 + HELD_ROOM_LEAD) - top), HELD_ROOM_SCREENS * fold));
}

/**
 * Whether a place keeps the room it held once its answer is in. It lets the room go when that moves nothing on screen:
 * when all of it is off screen (`onScreen` false), or when the answer's own end (`end`, px from the top of the screen)
 * is at or below the screen's foot (`fold`), so what sits under it stays off screen as it moves up.
 */
export function keepsHeldRoom({ onScreen, end, fold }: { onScreen: boolean; end: number; fold: number }): boolean {
  return onScreen && end < fold;
}

/**
 * The room a place keeps once its answer is in (`useHeldRoom`): what it held (`held`), cut back to reach the screen's
 * foot (`fold`) from its top (`top`) and no further, so only room that is off screen is given back. Never more than it
 * held.
 */
export function trimmedHeldRoom(held: number, top: number, fold: number): number {
  return Math.max(0, Math.min(held, Math.ceil(fold - top)));
}

/** No least height: the room is only what `heldRoomHeight` gives. */
const noFloor = () => 0;

/** Runs before paint in the browser; a static render (the tests') never runs it. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Holds room for an answer that comes late. When it goes out (`pending`, in the same commit as the press or the mount
 * that asked for it), the element `ref` points at takes at least the `floor` its width gives (px) and the height `heldRoomHeight` gives, so
 * what sits under it is off screen; as the visitor scrolls, it grows only while its own foot is below the screen's, so
 * that growing moves nothing they can see. The answer, whatever its height, then moves nothing a visitor sees. Once it
 * is in, the room is cut back to the screen's foot (`trimmedHeldRoom`) and stays until letting it go moves nothing on
 * screen (`keepsHeldRoom`). Set as an inline min-height in the browser only, so the server's HTML is unchanged.
 */
export function useHeldRoom(
  ref: RefObject<HTMLElement | null>,
  pending: boolean,
  floor: (width: number) => number = noFloor,
): void {
  useBeforePaint(() => {
    const element = ref.current;
    if (!element || typeof window === "undefined") return;
    const held = () => Number.parseFloat(element.style.minHeight) || 0;
    const hold = (next: number) => {
      if (next !== held()) element.style.minHeight = `${next}px`;
    };
    if (pending) {
      const fill = () => hold(heldRoomHeight(held(), element.getBoundingClientRect().top, window.innerHeight));
      hold(Math.max(held(), Math.ceil(floor(window.innerWidth))));
      fill();
      const follow = () => {
        if (element.getBoundingClientRect().bottom > window.innerHeight) fill();
      };
      window.addEventListener("scroll", follow, { passive: true });
      window.addEventListener("resize", follow);
      return () => {
        window.removeEventListener("scroll", follow);
        window.removeEventListener("resize", follow);
      };
    }
    if (held() === 0) return;
    let onScreen = true;
    let observer: IntersectionObserver | null = null;
    const stop = () => {
      observer?.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
    function check() {
      const top = element!.getBoundingClientRect().top;
      const end = element!.lastElementChild?.getBoundingClientRect().bottom ?? top;
      if (keepsHeldRoom({ onScreen, end, fold: window.innerHeight })) return;
      stop();
      element!.style.minHeight = "";
    }
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
        onScreen = entry.isIntersecting;
        check();
      });
      observer.observe(element);
    }
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();
    // What it kept is cut back once, to reach the screen's foot and no further: the lead past the foot was only for
    // scrolls while the answer was out, and the part it gives back is off screen.
    if (element.style.minHeight !== "") hold(trimmedHeldRoom(held(), element.getBoundingClientRect().top, window.innerHeight));
    return stop;
  }, [ref, pending, floor]);
}

/**
 * A placeholder: the muted step of the ladder, a 6px-cornered bar like every bar and track, or a 10px tile. It
 * holds still: nothing on the page moves before a visitor does something.
 */
function Bone({ className, tile = false }: { className?: string; tile?: boolean }) {
  return <span aria-hidden="true" className={cn("block bg-muted", tile ? "rounded-md" : "rounded-bar", className)} />;
}

/** Placeholder for the Clash Budget Index card while a festival day loads: the card's own surface. */
export function ScoreSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-surface-edge bg-card p-6", className)}>
      <Bone className="h-3 w-36" />
      <div className="mt-4 grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-end gap-x-5">
        <Bone tile className="h-9 w-24" />
        <div className="space-y-2 pb-1">
          <Bone className="h-3 w-32" />
          <Bone className="h-3 w-24" />
        </div>
      </div>
      {/* The index's 6px range track. */}
      <Bone className="mt-5 h-1.5 w-full" />
      <Bone className="mt-5 h-3 w-full" />
      <Bone className="mt-2 h-3 w-4/5" />
      <Bone className="mt-2 h-3 w-3/5" />
    </div>
  );
}

/** Placeholder for the clash list and timetable, on the board's 18rem rail. */
export function BoardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-10 xl:grid-cols-[18rem_minmax(0,1fr)]", className)}>
      <div className="space-y-3">
        <Bone className="h-3 w-48" />
        <Bone className="h-3 w-64" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex gap-3 border-t border-border pt-3">
            <Bone tile className="h-8 w-8" />
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <div className="grid grid-cols-[52px_repeat(5,minmax(0,1fr))] gap-5 pb-3">
          <span />
          {Array.from({ length: 5 }, (_, index) => (
            <Bone key={index} className="h-5 w-3/4" />
          ))}
        </div>
        <div className="mt-3 grid h-[40rem] grid-cols-[52px_repeat(5,minmax(0,1fr))] gap-5">
          <span />
          {Array.from({ length: 5 }, (_, column) => (
            <div key={column} className="space-y-6 pt-4">
              {Array.from({ length: 4 }, (_, row) => (
                <Bone key={row} tile className={cn("w-full", (row + column) % 2 ? "h-24" : "h-32")} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <Bone key={index} tile className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Placeholder for the agent panel while the page finds out whether the live agent is on. */
export function AgentSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-surface-edge bg-card p-6", className)}>
      <Bone className="h-4 w-2/3" />
      <Bone className="mt-4 h-3 w-full" />
      <Bone className="mt-2 h-3 w-5/6" />
      <Bone tile className="mt-6 h-9 w-40" />
    </div>
  );
}
