import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DISCLOSURE_HINT_CLASS,
  DISCLOSURE_MARK_CLASS,
  DISCLOSURE_ROW_CLASS,
  DISCLOSURE_SUMMARY_CLASS,
  MoreDetails,
} from "./more-details";

type Props = Omit<ComponentProps<typeof MoreDetails>, "children">;
const render = (props: Props) =>
  renderToStaticMarkup(createElement(MoreDetails, props as ComponentProps<typeof MoreDetails>, "Body"));

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

describe("MoreDetails", () => {
  it("is a closed native disclosure: a ruled row, the label and hint first in the markup, a hidden caret last (drawn first by CSS)", () => {
    const html = render({ summary: "Label", hint: "two lines", className: "mt-2" });
    expect(html).toMatch(/^<details class="group cc-disclosure mt-2">/);
    expect(html).not.toContain(" open");
    expect(html).toContain(
      `<summary class="${DISCLOSURE_SUMMARY_CLASS}">Label<span class="${DISCLOSURE_HINT_CLASS}">two lines</span><span aria-hidden="true" class="${DISCLOSURE_MARK_CLASS}"></span></summary>Body`,
    );
  });

  it("leaves the hint out when none is given", () => {
    const html = render({ summary: "Label" });
    expect(html).not.toContain(DISCLOSURE_HINT_CLASS);
  });

  it("defines every exported class in globals.css, with a 44px row, a CSS-only caret that turns down and no inset stripe when open", () => {
    for (const name of [DISCLOSURE_ROW_CLASS, DISCLOSURE_SUMMARY_CLASS, DISCLOSURE_HINT_CLASS, DISCLOSURE_MARK_CLASS]) {
      expect(css).toContain(`@utility ${name} {`);
    }
    expect(css).toMatch(/@utility cc-disclosure \{\s*border-top: 1px solid var\(--border\);/);
    expect(css).toMatch(/@utility cc-disclosure-summary \{[^}]*min-height: 2\.75rem;/);
    expect(css).toMatch(/@utility cc-disclosure-mark \{[^}]*order: -1;/);
    expect(css).toMatch(/details\[open\] > summary & \{\s*transform: rotate\(90deg\);/);
    // An open row is shown by the turned caret alone: no box-shadow stripe on the open summary.
    const summary = css.slice(css.indexOf("@utility cc-disclosure-summary {"), css.indexOf("@utility cc-disclosure-hint {"));
    expect(summary).not.toContain("box-shadow");
    expect(css).not.toMatch(/details\[open\] > & \{[^}]*box-shadow/);
  });
});
