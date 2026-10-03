import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FOOTER_SYNTHETIC } from "@/components/site/site-footer";
import { SYNTHETIC_NOTICE } from "@/lib/synthetic-notice";

// The layout draws the synthetic notice from the server's own flag, so it is in the server HTML of every
// page and does not wait for hydration. Invented list entries only.

vi.mock("next/font/google", () => ({
  Archivo: () => ({ variable: "font-archivo" }),
  JetBrains_Mono: () => ({ variable: "font-mono" }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function serve(list: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(list), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const entry = { id: "a", title: "A", city: null, sets: 3, stages: 2, scored_share: 0.9 };

async function html(): Promise<string> {
  const { default: RootLayout } = await import("./layout");
  const tree = await RootLayout({ children: createElement("p", null, "Page") } as never);
  return renderToStaticMarkup(tree);
}

describe("the root layout", () => {
  it("prints the synthetic notice and the invented-day footer when the server serves its invented day", async () => {
    serve([{ ...entry, synthetic: true }]);
    const markup = await html();
    expect(markup).toContain(SYNTHETIC_NOTICE);
    expect(markup).toContain(FOOTER_SYNTHETIC);
    expect(markup).not.toContain("saved Qloo responses");
  });

  it("prints neither for a real day, and does not fail when the list cannot be read", async () => {
    serve([entry]);
    const real = await html();
    expect(real).not.toContain(SYNTHETIC_NOTICE);
    expect(real).toContain("saved Qloo responses");
    serve({}, 500);
    expect(await html()).not.toContain(SYNTHETIC_NOTICE);
  });
});
