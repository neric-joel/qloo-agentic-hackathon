import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BudgetMove } from "./budget-move";

// Every figure below is invented for the test.
const RANGE = { low: 92.2, high: 108.6 };

function html(props: Partial<Parameters<typeof BudgetMove>[0]> = {}): string {
  return renderToStaticMarkup(createElement(BudgetMove, { before: 110.4, after: 104.1, range: RANGE, ...props }));
}

describe("BudgetMove verdict stamp", () => {
  it("marks the chip and underlines the After figure in the chip's colour when asked", () => {
    const lower = html({ stamp: "0-north-840" });
    expect(lower).toContain("cc-stamp ");
    expect(lower).toContain('<span class="cc-stamp-line">104.1</span>');
    expect(lower).toContain("--stamp:var(--success)");
    expect(html({ after: 112, stamp: "a" })).toContain("--stamp:var(--primary)");
    expect(html({ after: 110.4, stamp: "a" })).toContain("--stamp:var(--muted-foreground)");
  });

  it("adds nothing for the other readings that use it", () => {
    const plain = html();
    expect(plain).not.toContain("cc-stamp");
    expect(plain).not.toContain("--stamp");
  });
});

describe("BudgetMove bars", () => {
  it("draws Now in the grey graphic step and After in green for a lower index, as capsules on a muted track", () => {
    const lower = html();
    expect(lower).not.toMatch(/bg-foreground\/|color-mix/);
    expect(lower).toMatch(/rounded-bar[^"]*bg-ink-3/);
    expect(lower).toMatch(/rounded-bar[^"]*bg-success/);
    expect(lower.match(/rounded-bar bg-muted/g)).toHaveLength(2);
    // The green figure sits beside its arrow and the words that say lower is better.
    expect(lower).toContain("Clash Budget Index · lower is better");
    expect(lower).toMatch(/text-success"><svg/);
  });

  it("draws After in raspberry when the index goes up, and grey when it does not move", () => {
    expect(html({ after: 112 })).toMatch(/rounded-bar[^"]*bg-primary/);
    expect(html({ after: 110.4 }).match(/bg-ink-3/g)).toHaveLength(2);
  });
});
