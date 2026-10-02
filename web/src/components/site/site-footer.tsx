export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="container-page flex flex-col gap-2 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="type-wordmark text-base text-foreground">Clash Control</p>
        <p className="max-w-prose">
          Audience-overlap data comes from Qloo&rsquo;s API. Figures on this preview are simulated.
        </p>
      </div>
    </footer>
  );
}
