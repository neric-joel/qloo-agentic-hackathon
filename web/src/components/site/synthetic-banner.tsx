"use client";

import { FlaskConical } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { MOCK_STREAM_ENABLED } from "@/lib/mock-stream";
import { parsePresetList } from "@/lib/preset";
import { showsSyntheticNotice, SYNTHETIC_NOTICE } from "@/lib/synthetic-notice";

/** The notice itself, in the same strip as the simulated-data banner. */
export function SyntheticNotice() {
  return (
    <aside
      aria-label="Synthetic data notice"
      className="border-b border-warning/40 bg-warning-bg text-warning"
    >
      <p className="container-page flex items-start gap-2 py-2 text-xs leading-snug font-semibold sm:items-center">
        <FlaskConical aria-hidden="true" className="mt-px size-3.5 shrink-0 sm:mt-0" />
        <span>{SYNTHETIC_NOTICE}</span>
      </p>
    </aside>
  );
}

/**
 * Shown on the pages that print the day when the server has no built preset and serves its invented one
 * (`synthetic: true` on the preset list). `initial` is what the server already read from that list, so
 * the notice is in the server HTML and does not wait for hydration; the browser then asks again and
 * follows the answer. If the list cannot be read the page keeps `initial`: it reports its own errors.
 */
export function SyntheticBanner({ initial = false }: { initial?: boolean }) {
  const pathname = usePathname();
  const [synthetic, setSynthetic] = useState(initial);

  useEffect(() => {
    if (MOCK_STREAM_ENABLED) return; // the simulated-data banner already covers this build
    const controller = new AbortController();
    fetch("/api/presets", { signal: controller.signal, headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("no list"))))
      .then((raw) => {
        const first = parsePresetList(raw)[0];
        setSynthetic(first?.synthetic === true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!synthetic || !showsSyntheticNotice(pathname)) return null;
  return <SyntheticNotice />;
}
