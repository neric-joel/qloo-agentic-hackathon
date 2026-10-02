import { FlaskConical } from "lucide-react";

import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

/**
 * Shown on every page of a build made with NEXT_PUBLIC_MOCK_STREAM=1, so simulated output can
 * never be mistaken for live Qloo data.
 */
export function MockBanner() {
  if (!MOCK_STREAM_ENABLED) return null;
  return (
    <aside
      aria-label="Simulated data notice"
      className="border-b border-warning/40 bg-warning-bg text-warning"
    >
      <p className="container-page flex items-start gap-2 py-2 text-xs leading-snug font-semibold sm:items-center">
        <FlaskConical aria-hidden="true" className="mt-px size-3.5 shrink-0 sm:mt-0" />
        <span>Simulated data. Events are replayed from a built-in script and no requests reach Qloo.</span>
      </p>
    </aside>
  );
}
