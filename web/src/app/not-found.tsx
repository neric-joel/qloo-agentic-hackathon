import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="container-page py-16 sm:py-24">
      <p className="type-kicker text-muted-foreground">Error 404</p>
      <div className="@container">
        <h1 className="type-display mt-4">
          Off the
          <br />
          bill
        </h1>
      </div>
      <p className="mt-6 max-w-md text-lg text-muted-foreground">
        That page is not on the lineup. Head back to the start.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  );
}
