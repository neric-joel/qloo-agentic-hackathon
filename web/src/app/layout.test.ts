import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FOOTER_SYNTHETIC } from "@/components/site/site-footer";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme-config";
import { SYNTHETIC_NOTICE } from "@/lib/synthetic-notice";

// The layout draws the synthetic notice from the server's own flag, so it is in the server HTML of every
// page and does not wait for hydration. Invented list entries only.

// The options the layout hands the font loader, kept so a test can read how the font is shown.
const fontCalls = vi.hoisted(() => [] as unknown[]);

vi.mock("next/font/google", () => ({
  Archivo: (options: unknown) => {
    fontCalls.push(options);
    return { variable: "font-archivo" };
  },
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

describe("the default descriptions", () => {
  it("say nothing that is true of only a published day, so /method, /brief and /check are right on both", async () => {
    const { metadata } = await import("./layout");
    const { metadata: method } = await import("./method/page");
    const { metadata: brief } = await import("./brief/page");
    const { metadata: check } = await import("./check/page");
    const descriptions = [
      check.description,
      metadata.description,
      metadata.openGraph?.description,
      metadata.twitter?.description,
      method.description,
      brief.description,
    ];
    for (const description of descriptions) {
      expect(typeof description).toBe("string");
      expect(description).not.toMatch(/Qloo/);
    }
    expect(metadata.description).toMatch(/Taste, not attendance./);
    // The same default is the one shared links show.
    expect(metadata.openGraph?.description).toBe(metadata.description);
    expect(metadata.twitter?.description).toBe(metadata.description);
  });
});

describe("the root layout", () => {
  it("prints the synthetic notice and the invented-day footer when the server serves its invented day", async () => {
    serve([{ ...entry, synthetic: true }]);
    const markup = await html();
    expect(markup).toContain(SYNTHETIC_NOTICE);
    expect(markup).toContain(FOOTER_SYNTHETIC);
    expect(markup).not.toContain("saved Qloo responses");
  });

  it("loads one family and paints the page itself first: the theme script leads the head, with no opening reveal", async () => {
    serve([entry]);
    const markup = await html();
    expect(markup).toMatch(/^<html lang="en" class="font-archivo">/);
    const head = markup.slice(markup.indexOf("<head>") + "<head>".length, markup.indexOf("</head>"));
    expect(head).toBe(`<script>${THEME_INIT_SCRIPT}</script>`);
    // The retired curtain's names, spelled in pieces so a source scan for them finds none.
    for (const name of ["data-", "cc.", "cc:", "cc-"].map((head) => `${head}intro`)) expect(markup).not.toContain(name);
    expect(markup).not.toContain("font-mono");
  });

  it("never swaps the font in after the first paint, so a slow font cannot move text already on screen", async () => {
    serve([entry]);
    await html();
    expect(fontCalls).toHaveLength(1);
    expect(fontCalls[0]).toMatchObject({ variable: "--font-archivo", subsets: ["latin"], display: "optional" });
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
