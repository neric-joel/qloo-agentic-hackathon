import Link from "next/link";

import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="container-page flex flex-col gap-2 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <p className="type-wordmark text-base text-foreground">Clash Control</p>
          <Link
            href="/method"
            className="rounded-sm py-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            How we know
          </Link>
        </div>
        <p className="max-w-prose">
          {MOCK_STREAM_ENABLED
            ? "Figures on this preview are simulated, and no requests reach Qloo."
            : "Popularity and audience comparisons are saved Qloo responses; taste overlap and prices are calculated by this app from them. The festivals shown do not use Clash Control; their published timetables are scored by this app."}
        </p>
      </div>
    </footer>
  );
}
