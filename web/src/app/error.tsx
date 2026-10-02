"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/kernel/error-state";

export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /** Re-fetches and re-renders the failed segment (Next 16.3+). */
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container-page py-16 sm:py-24">
      <ErrorState
        title="This page hit a problem"
        titleAs="h1"
        message="Something went wrong while showing this page. Your data is safe. Try again, and if it keeps happening, reload."
        onRetry={retry}
        className="mx-auto max-w-xl"
      />
    </div>
  );
}
