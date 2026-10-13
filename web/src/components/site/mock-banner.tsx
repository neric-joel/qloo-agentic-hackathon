import { TriangleAlert } from "lucide-react";

import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

/**
 * Shown on every page of a build made with NEXT_PUBLIC_MOCK_STREAM=1, so simulated output can
 * never be mistaken for live Qloo data.
 */
export function MockBanner() {
  if (!MOCK_STREAM_ENABLED) return null;
  return (
    <aside aria-label="Simulated data notice" className="container-page pt-3">
      {/* One ink-edged card with its warning icon: no hairline across the page and no tinted ground. */}
      <p className="flex items-start gap-2 rounded-md border border-foreground bg-card px-4 py-2 text-xs leading-snug font-semibold text-foreground">
        <TriangleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
        <span>Simulated data. Events are replayed from a built-in script and no requests reach Qloo.</span>
      </p>
    </aside>
  );
}
