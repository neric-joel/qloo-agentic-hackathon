import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="container-page flex flex-col gap-2 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="type-wordmark text-base text-foreground">Clash Control</p>
        <p className="max-w-prose">
          {MOCK_STREAM_ENABLED
            ? "Figures on this preview are simulated, and no requests reach Qloo."
            : "Shared audience and draw (Qloo popularity) come from Qloo’s API. The festivals shown do not use Clash Control; their published timetables are scored independently."}
        </p>
      </div>
    </footer>
  );
}
