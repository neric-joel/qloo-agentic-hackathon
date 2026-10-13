"use client";

import { usePathname } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { showsSyntheticNotice, SYNTHETIC_NOTICE } from "@/lib/synthetic-notice";

import { useSynthetic } from "./synthetic-context";

/** The notice itself, in the same strip as the simulated-data banner. */
export function SyntheticNotice() {
  return (
    <aside aria-label="Synthetic data notice" className="container-page pt-3">
      {/* One ink-edged card with its warning icon: no hairline across the page and no tinted ground. */}
      <p className="flex items-start gap-2 rounded-md border border-foreground bg-card px-4 py-2 text-xs leading-snug font-semibold text-foreground">
        <TriangleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
        <span>{SYNTHETIC_NOTICE}</span>
      </p>
    </aside>
  );
}

/**
 * Shown on the pages that print the day when the server has no built preset and serves its invented one
 * (`synthetic: true` on the preset list). The flag is the page's one shared answer (`SyntheticProvider`):
 * the server HTML carries what the server read, and the browser then asks again and every reader of the
 * flag, the footer included, follows it. `initial` is the answer used when no provider is above, so the
 * banner mounted alone still renders from the server's reading.
 */
export function SyntheticBanner({ initial = false }: { initial?: boolean }) {
  const pathname = usePathname();
  const synthetic = useSynthetic(initial);
  if (!synthetic || !showsSyntheticNotice(pathname)) return null;
  return <SyntheticNotice />;
}
