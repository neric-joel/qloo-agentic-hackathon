import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Text for a polite live region that does not outlive its news: `say` sets it, and it clears itself
 * after `ms` (long enough for a screen reader to speak it) or when `say` is called again, so a
 * line such as "Testing Sprints at 14:15." is never still there after the page has moved on.
 */
export function useAnnouncement(ms = 4000): [string, (text: string) => void] {
  const [text, setText] = useState("");
  const timer = useRef<number | null>(null);

  const say = useCallback(
    (next: string) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setText(next);
      if (next) timer.current = window.setTimeout(() => setText(""), ms);
    },
    [ms],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return [text, say];
}
