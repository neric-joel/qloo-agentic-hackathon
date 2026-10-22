import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildSetViews } from "@/lib/clashes";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";

import { TimetableList } from "./timetable-list";

// Every name and figure below comes from the tiny invented test preset; none of it is Qloo data.

function list(synthetic: boolean) {
  const preset = parsePreset({ ...rawTinyPreset(), synthetic });
  const views = buildSetViews(preset, 0);
  const html = renderToStaticMarkup(createElement(TimetableList, { views, dayLabel: "Sat", onOpen: () => {}, synthetic }));
  return { views, html };
}

/** Each set's card (`<li class="rounded-sm ...">`), as markup, in order. */
function cards(html: string): string[] {
  return [...html.matchAll(/<li class="rounded-sm[^"]*">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** The text of each element that holds text directly. */
const leaves = (html: string) => [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);

describe("the phone's start-order list says whose lock it is (round 37, L33)", () => {
  it("names the owner on a locked card, on its own line under the time, and never shows a bare 'Locked'", () => {
    for (const synthetic of [false, true]) {
      const { views, html } = list(synthetic);
      const locked = views.filter((v) => v.slot.locked).map((v) => v.act.name);
      expect(locked.length).toBeGreaterThan(0);
      const all = cards(html);
      expect(all).toHaveLength(views.length);
      const words = synthetic ? "Locked: an invented fixed slot" : "Locked by this app: kept in place";
      for (const card of all) {
        // The card's own set is the name in its first paragraph (other names appear in its clash buttons).
        const own = /<p class="min-w-0 font-semibold[^"]*">([^<]*)<\/p>/.exec(card)?.[1];
        expect(own).toBeDefined();
        const isLocked = locked.includes(own ?? "");
        expect(leaves(card)).not.toContain("Locked");
        if (isLocked) {
          // After the time line, with the icon hidden from screen readers.
          const time = card.indexOf("font-mono");
          expect(time).toBeGreaterThan(-1);
          expect(card.indexOf(words)).toBeGreaterThan(time);
          expect(card).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>Locked/);
          if (!synthetic) expect(text(card)).not.toContain("invented");
          else expect(text(card)).not.toContain("by this app");
        } else {
          expect(text(card)).not.toMatch(/\blocked?\b/i);
        }
      }
    }
  });
});
