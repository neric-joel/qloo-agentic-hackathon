import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ClashDisc,
  clashMarkLabel,
  DiamondGlyph,
  LabelBadge,
  Meter,
  OVERLAP,
  OverlapEdges,
  OverlapPattern,
  OverlapSwatch,
  OverlapWindow,
  SeenDiscGlyph,
} from "./marks";

describe("Meter", () => {
  it("is drawn at its final width in the server HTML, with nothing waiting to play", () => {
    for (const [value, width] of [
      [0.973, "97.3%"],
      [0, "0%"],
      [1.4, "100%"],
      [-0.2, "0%"],
    ] as const) {
      const html = renderToStaticMarkup(createElement(Meter, { value, label: "Draw 97 of 100" }));
      expect(html).toContain(`style="width:${width}"`);
      expect(html).toContain("cc-meter-fill");
      expect(html).not.toContain("data-reveal");
      expect(html).not.toContain("scaleX");
      // A meter is a bar, so its track is a capsule (rounded-bar) and clips the fill.
      expect(html).toMatch(/class="[^"]*\boverflow-hidden\b[^"]*\brounded-bar\b/);
      expect(html).not.toMatch(/rounded-(sm|md|lg|xl|full)/);
      expect(html).toContain('aria-label="Draw 97 of 100"');
    }
  });
});

describe("OverlapPattern", () => {
  it("is the shared-time hatch: 16px user-space tiles turned 45 degrees, one 1.5px raspberry line every 16px at full opacity", () => {
    expect(OVERLAP).toEqual({ period: 16, stroke: 1.5, gap: 2 });
    const html = renderToStaticMarkup(
      createElement("svg", null, createElement("defs", null, createElement(OverlapPattern, { id: "cc-overlap-test" }))),
    );
    expect(html).toContain('<pattern id="cc-overlap-test" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(45)">');
    expect(html).toContain('<line x1="0" y1="0" x2="0" y2="16" stroke="var(--primary)" stroke-width="1.5"></line>');
    expect(html).not.toMatch(/opacity/);
  });
});

describe("OverlapWindow", () => {
  const bar = { x: "10%", y: 4, width: "60%", height: 12 };
  const html = renderToStaticMarkup(
    createElement(
      "svg",
      null,
      createElement(
        OverlapWindow,
        { patternId: "p", clipId: "c", bar, span: { x: "40%", width: "30%" }, className: "grow" },
        createElement(OverlapEdges, { xs: ["40%", "70%"], bar }),
      ),
    ),
  );

  it("clips to the bar's capsule and lays a card rect under the hatch", () => {
    expect(html).toContain('<clipPath id="c"><rect x="10%" y="4" width="60%" height="12" rx="6"></rect></clipPath>');
    expect(html).toContain('<g clip-path="url(#c)" class="grow">');
    const group = html.slice(html.indexOf('<g clip-path="url(#c)"'));
    const card = group.indexOf('<rect x="40%" y="4" width="30%" height="12" fill="var(--card)">');
    const hatch = group.indexOf('<rect x="40%" y="4" width="30%" height="12" fill="url(#p)">');
    expect(card).toBeGreaterThan(-1);
    expect(hatch).toBeGreaterThan(card);
  });

  it("renders its children inside the clipped group and ends with a 4px card halo on the capsule", () => {
    const group = html.slice(html.indexOf('<g clip-path="url(#c)"'));
    const edges = group.indexOf('stroke="var(--primary)"');
    const halo = group.indexOf('<rect x="10%" y="4" width="60%" height="12" rx="6" fill="none" stroke="var(--card)" stroke-width="4">');
    expect(edges).toBeGreaterThan(group.indexOf('fill="url(#p)"'));
    expect(halo).toBeGreaterThan(edges);
    expect(group.endsWith('stroke-width="4"></rect></g></svg>')).toBe(true);
    expect(html).not.toMatch(/opacity/);
  });

  it("runs each edge cut from the top of the bar to its foot, 1px raspberry with crisp butt ends", () => {
    const lines = [...html.matchAll(/<line [^>]*>/g)].map((m) => m[0]);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain('y1="4" y2="16"');
      expect(line).toContain('stroke="var(--primary)" stroke-width="1" stroke-linecap="butt" shape-rendering="crispEdges"');
    }
    expect(lines[0]).toContain('x1="40%" x2="40%"');
    expect(lines[1]).toContain('x1="70%" x2="70%"');
  });
});

describe("OverlapSwatch", () => {
  it("is a 40x12 capsule key: card fill, its own hatch, a card halo and a 1px ink outline on top", () => {
    const html = renderToStaticMarkup(createElement(OverlapSwatch));
    expect(html).toMatch(/^<svg width="40" height="12" viewBox="0 0 40 12" aria-hidden="true"/);
    expect(html).toMatch(/<pattern id="cc-overlap-[^"]+" patternUnits="userSpaceOnUse" width="16" height="16"/);
    expect(html).toContain('<rect x="0" y="0" width="40" height="12" rx="6" fill="none" stroke="var(--card)" stroke-width="3">');
    expect(html).toContain('<rect x="0.5" y="0.5" width="39" height="11" rx="5.5" fill="none" stroke="var(--foreground)"');
    expect(html.endsWith('stroke="var(--foreground)" stroke-width="1"></rect></svg>')).toBe(true);
    expect(html).not.toMatch(/opacity/);
  });
});

describe("DiamondGlyph", () => {
  it("is the board's hidden-clash mark: an ink ring on the card in a 12px box, never raspberry and never the yellow highlight", () => {
    const html = renderToStaticMarkup(createElement(DiamondGlyph));
    expect(html).toContain('viewBox="0 0 12 12"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("size-3");
    expect(html).toContain('<circle data-mark="hidden"');
    // Hidden is a label, not shared time: its ring is ink (one meaning per hue).
    expect(html).toContain('fill="var(--card)" stroke="var(--foreground)" stroke-width="2"');
    expect(html).not.toContain("var(--primary)");
    expect(html).not.toContain("highlight");
    expect(html).not.toContain("rotate");
  });
});

describe("SeenDiscGlyph", () => {
  it("is the board's seen-clash mark: a filled raspberry disc in a 12px box", () => {
    const html = renderToStaticMarkup(createElement(SeenDiscGlyph));
    expect(html).toContain('viewBox="0 0 12 12"');
    expect(html).toContain('<circle data-mark="seen"');
    expect(html).toContain('fill="var(--primary)"');
  });
});

describe("LabelBadge", () => {
  it("prints a clash label as the board's one tag: Hidden in ink with its outlined ink disc, the rest in ink", () => {
    const hidden = renderToStaticMarkup(createElement(LabelBadge, { label: "hidden" }));
    expect(hidden).toMatch(/class="tag [^"]*tag-ink/);
    expect(hidden).not.toMatch(/tag-primary|text-primary|var\(--primary\)/);
    expect(hidden).toContain('data-mark="hidden"');
    expect(hidden).not.toMatch(/rounded-full|bg-highlight/);
    const other = renderToStaticMarkup(createElement(LabelBadge, { label: "false" }));
    expect(other).toMatch(/class="tag [^"]*tag-ink/);
    expect(other).not.toContain("data-mark");
  });
});

describe("ClashDisc", () => {
  it("is the board's clash link marker: a 22px round disc, never a turned square, filled raspberry when seen and an ink ring when hidden", () => {
    for (const hidden of [false, true]) {
      const html = renderToStaticMarkup(createElement(ClashDisc, { hidden }));
      expect(html).toMatch(/class="[^"]*\brounded-full\b/);
      expect(html).toContain("size-5.5");
      expect(html).not.toMatch(/rotate/);
      expect(html).toContain('aria-hidden="true"');
    }
    expect(renderToStaticMarkup(createElement(ClashDisc, { hidden: false }))).toMatch(/data-clash-disc="seen"[^>]*bg-primary/);
    const hidden = renderToStaticMarkup(createElement(ClashDisc, { hidden: true }));
    expect(hidden).toMatch(/data-clash-disc="hidden"[^>]*border-2 border-foreground bg-card/);
    // Hidden is a label, not shared time: no raspberry on its disc (one meaning per hue).
    expect(hidden).not.toMatch(/border-primary|bg-primary|text-primary/);
  });
});

describe("Hidden in ink where another file draws it", () => {
  // The list's label word (clash-list.tsx) and the key's swatch (timetable-legend.tsx) carry their own
  // colour classes; globals.css holds both to ink, outside every layer, so those classes cannot win.
  const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const depthAt = (index: number) => {
    let depth = 0;
    for (let i = 0; i < index; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    return depth;
  };

  it("draws the key's Hidden clash swatch as an ink ring and the list's label word in ink, outside any layer", () => {
    for (const rule of [
      /span\[data-mark="hidden"\]\s*\{\s*border-color:\s*var\(--foreground\);\s*\}/,
      /\[data-clash-badge\]\s*\{\s*color:\s*var\(--foreground\);\s*\}/,
    ]) {
      const match = rule.exec(css);
      expect(match).not.toBeNull();
      expect(depthAt(match!.index)).toBe(0);
    }
    expect(css).not.toMatch(/\[data-mark="hidden"\][^{]*\{[^}]*var\(--primary\)/);
  });
});

describe("clashMarkLabel", () => {
  it("names a hidden clash's disc and link by rank and pair, built from the data", () => {
    const pair = { a: { name: "Nadine Shah" }, b: { name: "Abel Selaocoe & the Bantu Ensemble" } };
    expect(clashMarkLabel({ rank: 3, label: "hidden", ...pair })).toBe(
      "Hidden clash 3: Nadine Shah and Abel Selaocoe & the Bantu Ensemble",
    );
    expect(clashMarkLabel({ rank: 1, label: null, ...pair })).toBe("Clash 1: Nadine Shah and Abel Selaocoe & the Bantu Ensemble");
  });
});
