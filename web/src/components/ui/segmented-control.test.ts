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

describe("SegmentedControl", () => {
  it("is a named radio group whose selected option is exposed as the one checked radio", () => {
    const html = render();
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Pick one"');
    const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => /\bchecked=""/.test(r))).toEqual([expect.stringContaining('value="b"')]);
    // The selected tab turns full ink through its checked radio, never by colour alone: it also
    // draws a 3px ink marker (the server HTML carries the per-tab fallback until the slide is measured).
    expect(html).toContain("peer-checked:text-foreground");
    expect(html).toContain("peer-checked:after:block");
    expect(html).toContain('data-slot="segmented-marker"');
  });

  it("checks nothing when the value matches no option", () => {
    expect(render({ value: null })).not.toMatch(/\bchecked=""/);
  });

  it("draws both variants as the same row of 44px tabs: no track, thumb, fill or hairline", () => {
    for (const variant of ["default", "tabs"] as const) {
      const html = render({ variant });
      expect(html).not.toMatch(/\bbg-muted\b/);
      expect(html).not.toMatch(/\bbg-card\b/);
      expect(html).not.toContain("segmented-thumb");
      expect(html).not.toMatch(/\bborder-(border|border-strong|input)\b/);
      expect(html).toContain("min-h-11");
      expect(html).toMatch(/h-\[3px\][^"]*rounded-bar[^"]*bg-foreground/);
    }
    expect(render({ variant: "default" })).toBe(render({ variant: "tabs" }));
  });

  it("slides the marker only when motion is welcome", () => {
    const html = render();
    expect(html).toContain("motion-safe:transition-[transform,width]");
    expect(html).toContain("motion-safe:duration-[180ms]");
    expect(html).toContain("motion-safe:ease-out");
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
