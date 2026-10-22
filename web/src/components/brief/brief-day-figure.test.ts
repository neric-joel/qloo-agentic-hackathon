import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FIGURE_FRAMES, briefFigure, sharedMinutes, type BriefFigure } from "@/lib/brief";
import { rawTinyPreset } from "@/lib/fixtures/tiny-preset";
import { parsePreset } from "@/lib/preset";
import type { Plan } from "@/lib/stack";

import { BriefDayFigure } from "./brief-day-figure";

// Every name and figure below is invented for the test: the tiny preset (Ann Arbor on Main 20:00-21:30, Bo Diddly
// Squat on Side 20:30-22:00, Cy Twombly on Side 16:40-17:40; one ranked clash, Ann Arbor and Bo Diddly Squat).

const published = () => parsePreset(rawTinyPreset());

/** Bo Diddly Squat kept 30 minutes later on Side, 21:00-22:30: it still shares 21:00-21:30 with Ann Arbor. */
const kept: Plan = {
  publishedBudget: 104.2,
  budget: 101.5,
  steps: [{ act: "Bo Diddly Squat", actId: "bo", move: "Bo Diddly Squat: moved", stage: "Side", stageId: "side", day: 0, start: "21:00", end: "22:30", budgetAfter: 101.5 }],
  clashes: [],
  options: null,
};

function keptFigure(): BriefFigure {
  const preset = published();
  return briefFigure(preset, 0, "Saturday", kept, { pair: { aId: "ann", bId: "bo" }, minutes: sharedMinutes(preset, 0, kept) })!;
}

const render = (figure: BriefFigure) => renderToStaticMarkup(createElement(BriefDayFigure, { figure }));
const svgs = (html: string) => html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
const textsOf = (svg: string, data: string) => [...svg.matchAll(new RegExp(`<text [^>]*${data}[^>]*>([^<]*)</text>`, "g"))].map((m) => m[1]);
/** The corner a frame gives every mark: a third of its bar's height or a little less (lib/brief.ts FIGURE_FRAMES). */
const radiusOf = (svg: string) => String(FIGURE_FRAMES[attr(svg, "data-frame") as keyof typeof FIGURE_FRAMES].radius);

describe("the brief's day figure (round 36)", () => {
  it("draws two frames of the same static SVG, wide from 640px and on paper, narrow on a phone, at full text width", () => {
    const html = render(keptFigure());
    expect(html.startsWith('<figure data-brief-figure="" class="break-inside-avoid">')).toBe(true);
    const [wide = "", narrow = ""] = svgs(html);
    expect(attr(wide, "data-frame")).toBe("wide");
    expect(attr(wide, "class")).toContain("hidden sm:block print:block");
    expect(attr(narrow, "data-frame")).toBe("narrow");
    expect(attr(narrow, "class")).toContain("block sm:hidden print:hidden");
    for (const svg of [wide, narrow]) {
      expect(attr(svg, "width")).toBe("100%");
      expect(attr(svg, "class")).toContain("w-full");
      expect(attr(svg, "viewBox")).toMatch(/^0 0 \d+ [\d.]+$/);
    }
  });

  it("draws the moved set's published slot as a dashed outline with the bar's corners, under the bars", () => {
    for (const svg of svgs(render(keptFigure()))) {
      const ghosts = tags(svg, "rect").filter((tag) => attr(tag, "data-ghost") !== null);
      expect(ghosts).toHaveLength(1);
      const [ghost] = ghosts;
      expect(attr(ghost, "data-ghost")).toBe("bo");
      expect(attr(ghost, "stroke-dasharray")).toBe("3 2");
      expect(attr(ghost, "fill")).toBe("none");
      expect(attr(ghost, "stroke")).toBe("var(--foreground)");
      expect(attr(ghost, "rx")).toBe(radiusOf(svg));
      expect(svg.indexOf("data-ghost")).toBeLessThan(svg.indexOf("data-set="));
      // The moved set itself is a solid bar, marked moved.
      const mover = tags(svg, "rect").find((tag) => attr(tag, "data-set") === "bo") ?? "";
      expect(mover).toContain('data-moved=""');
      expect(attr(mover, "stroke-dasharray")).toBeNull();
    }
  });

  it("hatches the minutes the mover shares with its named partner: a 45-degree line pattern in the current colour, raspberry on screen and ink on paper, clipped by each bar", () => {
    for (const svg of svgs(render(keptFigure()))) {
      const pattern = tags(svg, "pattern")[0] ?? "";
      expect(attr(pattern, "patternTransform")).toBe("rotate(45)");
      expect(attr(pattern, "class")).toBe("text-primary print:text-foreground");
      expect(svg).toMatch(/<pattern [^>]*><line [^>]*stroke="currentColor"[^>]*>(<\/line>)?<\/pattern>/);
      const id = attr(pattern, "id");
      const hatched = tags(svg, "rect").filter((tag) => attr(tag, "data-hatch") !== null);
      // One hatch on each of the pair's two bars, filled with the pattern and clipped by that bar's rounded shape.
      expect(hatched.map((tag) => attr(tag, "data-hatch")).sort()).toEqual(["ann", "bo"]);
      for (const tag of hatched) expect(attr(tag, "fill")).toBe(`url(#${id})`);
      expect(tags(svg, "clipPath")).toHaveLength(2);
      for (const clip of svg.match(/<clipPath [^>]*>[\s\S]*?<\/clipPath>/g) ?? []) expect(attr(tags(clip, "rect")[0] ?? "", "rx")).toBe(radiusOf(svg));
      // The wash under the hatch is on the screen only; the pattern is the only hue the drawing carries.
      expect(svg).toMatch(/fill="var\(--shared-wash\)" class="print:hidden"/);
      expect(svg).not.toMatch(/var\(--primary\)|var\(--prov-qloo\)|#[0-9a-f]{3,8}\b|oklch\(/i);
    }
  });

  it("names only the sets the sheet names, each whole: the mover and its partner here, no other set", () => {
    const figure = keptFigure();
    for (const svg of svgs(render(figure))) {
      expect(textsOf(svg, "data-name").sort()).toEqual(["Ann Arbor", "Bo Diddly Squat"]);
      expect(svg).not.toContain("Cy Twombly");
      // One lane per stage, named; hour labels only, and no other number.
      expect(textsOf(svg, "data-stage")).toEqual(["Main", "Side"]);
      for (const hour of textsOf(svg, "data-hour")) expect(hour).toMatch(/^\d{2}:00$/);
      const bare = svg.replace(/<text [^>]*data-hour[^>]*>[^<]*<\/text>/g, "").replace(/<[^>]+>/g, " ");
      expect(bare).not.toMatch(/\d/);
    }
  });

  it("captions it in at most two short sentences, which its title and description carry", () => {
    const figure = keptFigure();
    const html = render(figure);
    const caption = html.match(/<figcaption[^>]*>([^<]*)<\/figcaption>/)?.[1];
    expect(caption).toBe("Saturday, as your plan leaves it. Hatched: minutes shared with Ann Arbor. Dashed: the published slot.");
    expect(caption!.length).toBeLessThan(140);
    for (const svg of svgs(html)) {
      const title = svg.match(/<title id="([^"]+)">([^<]*)<\/title>/);
      const desc = svg.match(/<desc id="([^"]+)">([^<]*)<\/desc>/);
      expect(`${title?.[2]} ${desc?.[2]}`).toBe(caption);
      expect(attr(svg, "role")).toBe("img");
      expect(attr(svg, "aria-labelledby")).toBe(title?.[1]);
      expect(attr(svg, "aria-describedby")).toBe(desc?.[1]);
    }
    // The ids of the two frames never collide.
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("with no kept move, draws the day as published with the costliest clash hatched, and no dashed slot", () => {
    const figure = briefFigure(published(), 0, "Saturday", null)!;
    const html = render(figure);
    expect(html).toContain("<figcaption");
    expect(html.match(/<figcaption[^>]*>([^<]*)<\/figcaption>/)?.[1]).toBe("Saturday, as published. Hatched: minutes shared by the costliest clash.");
    for (const svg of svgs(html)) {
      expect(svg).not.toContain("data-ghost");
      expect(svg).not.toContain("data-moved");
      expect(tags(svg, "rect").filter((tag) => attr(tag, "data-hatch") !== null).map((tag) => attr(tag, "data-hatch")).sort()).toEqual(["ann", "bo"]);
      expect(textsOf(svg, "data-name").sort()).toEqual(["Ann Arbor", "Bo Diddly Squat"]);
    }
  });

  it("has no motion, no control and no tooltip, and draws every mark as a rounded rectangle, never a capsule", () => {
    for (const figure of [keptFigure(), briefFigure(published(), 0, "Saturday", null)!]) {
      const html = render(figure);
      expect(html).not.toMatch(/<(animate|animateTransform|set|button|a|input)\b|tabindex|onClick|animate-|transition|data-anim/i);
      for (const svg of svgs(html)) {
        expect(attr(svg, "class")).toContain("pointer-events-none");
        expect(attr(svg, "focusable")).toBe("false");
        // Every set, slot and clip has its frame's corner, under half its height (the day drawing's rounded
        // rectangle, smaller); only the fills clipped inside a bar have none of their own.
        for (const rect of tags(svg, "rect")) {
          if (attr(rect, "data-hatch") !== null || attr(rect, "fill") === "var(--shared-wash)") expect(attr(rect, "rx")).toBeNull();
          else {
            expect(attr(rect, "rx")).toBe(radiusOf(svg));
            expect(Number(attr(rect, "rx"))).toBeGreaterThan(0);
            expect(Number(attr(rect, "rx"))).toBeLessThan(Number(attr(rect, "height")) / 2);
          }
        }
        expect(tags(svg, "rect").filter((rect) => attr(rect, "data-set") !== null)).toHaveLength(3);
      }
      expect(html).not.toMatch(/rounded-(?!full)|rounded-\[/);
    }
  });

  it("sets its names at 10 units in the wide frame, in ink, with its caption's own print size at 9 pt (the brief sheet prints both at 9.5 pt, round 37 L75)", () => {
    const html = render(keptFigure());
    const [wide = ""] = svgs(html);
    expect(attr(wide, "font-size")).toBe("10");
    expect(attr(wide, "viewBox")?.split(" ")[2]).toBe("718");
    for (const name of tags(wide, "text").filter((tag) => attr(tag, "data-name") !== null)) {
      expect(attr(name, "fill")).toBe("var(--foreground)");
      expect(attr(name, "font-weight")).toBe("600");
    }
    expect(html).toMatch(/<figcaption class="[^"]*print:text-\[9pt\][^"]*">/);
  });

  it("lifts each name off the hour gridlines with a halo in the sheet's colour, drawn before the marks so it cuts none", () => {
    for (const svg of svgs(render(keptFigure()))) {
      const names = tags(svg, "text").filter((tag) => attr(tag, "data-name") !== null);
      expect(names).toHaveLength(2);
      for (const name of names) {
        expect(attr(name, "stroke")).toBe("var(--card)");
        expect(attr(name, "paint-order")).toBe("stroke");
      }
      // After the gridlines, before the dashed slot and every bar.
      expect(svg.lastIndexOf("<line")).toBeLessThan(svg.indexOf("data-name="));
      expect(svg.lastIndexOf("data-name=")).toBeLessThan(svg.indexOf("data-ghost="));
      expect(svg.lastIndexOf("data-name=")).toBeLessThan(svg.indexOf("data-set="));
    }
  });
});
