"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The page's running order: its sections as one compact horizontal sequence that wraps, set once at every width
 * after the short version. Each entry is one link: the section's 14px title, with no numeral (the list's order is
 * the page's order). The link is 44px tall (6px above and below a 32px line), and entries sit 24px apart. Inactive
 * entries are muted; the active one is in ink, semibold, with a 2px ink underline 4px off it. Wayfinding is ink,
 * never raspberry, and there is no stripe, dash, pill or tick. The nav is named "On this page" for screen readers, with no visible label. The
 * section crossing a line 30% down the viewport is the active one; none is marked above the first section. The
 * change is instant, so there is no motion to guard. Without JavaScript it is a plain list of links.
 */
export function ContentsRail({ items }: { items: readonly { id: string; title: string }[] }) {
  const [active, setActive] = useState<string | null>(null);
  const ids = items.map((item) => item.id).join("|");

  useEffect(() => {
    const order = ids.split("|");
    const crossing = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) crossing.set(entry.target.id, entry.isIntersecting);
        setActive(order.find((id) => crossing.get(id)) ?? null);
      },
      // A one-percent band 30% down the viewport: the sections touch, so at most one crosses it.
      { rootMargin: "-30% 0px -69% 0px" },
    );
    for (const id of order) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids]);

  return (
    <nav aria-label="On this page">
      <ol className="flex flex-wrap gap-x-6 text-sm">
        {items.map(({ id, title }) => {
          const on = active === id;
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "group inline-flex min-h-11 items-baseline py-1.5 leading-8 hover:text-foreground",
                  on ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "underline-offset-4",
                    on ? "font-semibold underline decoration-2 decoration-foreground" : "group-hover:underline",
                  )}
                >
                  {title}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
