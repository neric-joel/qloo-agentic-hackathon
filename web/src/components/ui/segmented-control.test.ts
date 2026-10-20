import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SegmentedControl, stepIndex, type SegmentedOption } from "./segmented-control";

const OPTIONS: readonly SegmentedOption<"a" | "b" | "c">[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

const render = (props: Partial<Parameters<typeof SegmentedControl<"a" | "b" | "c">>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SegmentedControl<"a" | "b" | "c">, {
      label: "Pick one",
      value: "b",
      onValueChange: () => {},
      options: OPTIONS,
      ...props,
    }),
  );

/** The class list of the first element matching `pattern` (the pattern's first group is the class). */
const classes = (html: string, pattern: RegExp) => (pattern.exec(html)?.[1] ?? "").split(" ");

describe("SegmentedControl", () => {
  it("is a named radio group whose selected option is exposed as the one checked radio", () => {
    const html = render();
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Pick one"');
    const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => /\bchecked=""/.test(r))).toEqual([expect.stringContaining('value="b"')]);
    // The selected option turns full ink through its checked radio, never by colour alone: it also sits on
    // the thumb (the server HTML carries the option's own plate until the thumb is measured).
    expect(html).toContain("peer-checked:text-foreground");
    expect(html).toContain("peer-checked:before:block");
    expect(html).toContain('data-slot="segmented-marker"');
  });

  it("checks nothing when the value matches no option", () => {
    expect(render({ value: null })).not.toMatch(/\bchecked=""/);
  });

  it("draws a soft track: equal columns on the muted fill, no border, the 10 px control corner, 44 px tall", () => {
    for (const variant of ["default", "tabs"] as const) {
      const html = render({ variant });
      const track = classes(html, /^<div role="radiogroup" aria-label="Pick one" class="([^"]*)"/);
      expect(track).toEqual(expect.arrayContaining(["inline-grid", "grid-flow-col", "auto-cols-fr", "bg-muted", "rounded-md", "min-h-11"]));
      expect(track.join(" ")).not.toMatch(/\bborder\b|shadow|rounded-(full|lg|xl|sm|none)/);
      // Each option is a 44 px label with the same corner, so its focus ring can trace the thumb.
      const option = classes(html, /<input type="radio"[^>]*><span class="([^"]*)"/);
      expect(option).toEqual(expect.arrayContaining(["h-11", "rounded-md", "text-muted-foreground", "peer-checked:text-foreground"]));
    }
    expect(render({ variant: "default" })).toBe(render({ variant: "tabs" }));
  });

  it("insets the thumb 4 px with the 6 px mark corner, card-white with a hairline edge, so it is concentric with the track", () => {
    const html = render();
    const thumb = classes(html, /<span aria-hidden="true" data-slot="segmented-marker" class="([^"]*)"/);
    expect(thumb).toEqual(expect.arrayContaining(["absolute", "top-1", "bottom-1", "rounded-xs", "border", "border-border-strong", "bg-card"]));
    expect(thumb.join(" ")).not.toMatch(/rounded-(full|bar|md|lg)|shadow|h-\[3px\]/);
    // Before it is measured, the chosen option draws the same plate: the same inset, fill, edge and corner.
    const option = classes(html, /<input type="radio"[^>]*><span class="([^"]*)"/).join(" ");
    for (const part of ["before:absolute", "before:inset-1", "before:rounded-xs", "before:border", "before:border-border-strong", "before:bg-card"]) {
      expect(option).toContain(part);
    }
    expect(option).toContain("group-data-measured/seg:peer-checked:before:hidden");
    // Forced-colors modes drop the plate and underline the chosen option instead.
    expect(thumb).toContain("forced-colors:hidden");
    expect(option).toContain("forced-colors:before:hidden");
    expect(option).toContain("peer-checked:forced-colors:underline");
  });

  it("moves the thumb by transform alone, 180 ms on the house ease-out, only when motion is welcome; the labels change colour at once", () => {
    const html = render();
    const thumb = classes(html, /data-slot="segmented-marker" class="([^"]*)"/).join(" ");
    expect(thumb).toContain("motion-safe:transition-[transform]");
    expect(thumb).toContain("motion-safe:duration-(--dur-state)");
    expect(thumb).toContain("motion-safe:ease-(--ease-out)");
    expect(thumb).not.toMatch(/transition-\[transform,width\]|transition-all/);
    // Equal columns, so the measured thumb sets its width once and only translates: no scale anywhere.
    const source = readFileSync(join(__dirname, "segmented-control.tsx"), "utf8");
    expect(source).toContain("transform: `translateX(${thumb.x}px)`");
    expect(source).not.toMatch(/scaleX|scale\(/);
    // No colour transition on the options.
    expect(html).not.toMatch(/transition-colors/);
  });

  it("traces the thumb with the focus ring: 2 px, the ring colour, offset 4 px inside the option", () => {
    const option = classes(render(), /<input type="radio"[^>]*><span class="([^"]*)"/);
    expect(option).toEqual(expect.arrayContaining(["peer-focus-visible:outline-2", "peer-focus-visible:-outline-offset-4", "peer-focus-visible:outline-ring"]));
  });

  it("fills the row when asked, every option still an equal column", () => {
    const track = classes(render({ fill: true }), /^<div role="radiogroup" aria-label="Pick one" class="([^"]*)"/);
    expect(track).toEqual(expect.arrayContaining(["grid", "w-full", "auto-cols-fr", "grid-flow-col"]));
    expect(track).not.toContain("inline-grid");
  });

  it("draws a pending control in place, its inputs disabled but nothing dimmed", () => {
    const html = render({ pending: true });
    const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((m) => m[0]);
    for (const radio of radios) expect(radio).toContain('disabled=""');
    expect(html).not.toContain("peer-disabled:opacity-50");
    // A disabled group still dims.
    expect(render({ disabled: true })).toContain("peer-disabled:opacity-50");
  });

  it("holds no div inside the group, so a reader of the markup finds every option in it", () => {
    const html = render();
    const group = html.match(/<div role="radiogroup" aria-label="Pick one"[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(group.match(/<input type="radio"/g)).toHaveLength(3);
  });

  it("keeps the labels for screen readers when compact on phones", () => {
    expect(render({ compactOnMobile: true })).toContain('<span class="max-sm:sr-only">Alpha</span>');
  });
});

describe("stepIndex (arrow keys)", () => {
  it("moves forward with ArrowRight and back with ArrowLeft, wrapping at the ends", () => {
    expect(stepIndex(OPTIONS, 1, "ArrowRight")).toBe(2);
    expect(stepIndex(OPTIONS, 2, "ArrowRight")).toBe(0);
    expect(stepIndex(OPTIONS, 1, "ArrowLeft")).toBe(0);
    expect(stepIndex(OPTIONS, 0, "ArrowLeft")).toBe(2);
    expect(stepIndex(OPTIONS, 0, "ArrowDown")).toBe(1);
    expect(stepIndex(OPTIONS, 0, "ArrowUp")).toBe(2);
  });

  it("skips disabled options and ignores other keys or a disabled group", () => {
    const options = [{}, { disabled: true }, {}];
    expect(stepIndex(options, 0, "ArrowRight")).toBe(2);
    expect(stepIndex(options, 2, "ArrowLeft")).toBe(0);
    expect(stepIndex(options, 0, "Enter")).toBe(-1);
    expect(stepIndex(options, 0, "ArrowRight", true)).toBe(-1);
    expect(stepIndex([{}, { disabled: true }], 0, "ArrowRight")).toBe(-1);
  });
});
