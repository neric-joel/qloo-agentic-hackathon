import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import CheckPage from "@/app/check/page";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { announcement, runCheck } from "@/lib/check";
import { SAMPLE_GRID, SAMPLE_SETTINGS } from "@/lib/check-sample";

import { CheckResults, SHARED_SHOWN } from "./check-results";
import { CheckTool } from "./check-tool";

// Every name below is invented for the test.

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The page without the fields the visitor typed into: what the page itself says back. */
function withoutFields(html: string): string {
  return html.replace(/<textarea[\s\S]*?<\/textarea>/g, "").replace(/<input[^>]*>/g, "");
}

function throwing(what: string) {
  return () => {
    throw new Error(`the check page tried to use ${what}`);
  };
}

/** Network, beacon and storage calls replaced by stubs that throw if anything reaches them. */
function stubNetwork() {
  vi.stubGlobal("fetch", throwing("fetch"));
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      constructor() {
        throwing("XMLHttpRequest")();
      }
    },
  );
  vi.stubGlobal("navigator", { sendBeacon: throwing("navigator.sendBeacon") });
  vi.stubGlobal("WebSocket", throwing("WebSocket"));
  vi.stubGlobal("EventSource", throwing("EventSource"));
}

afterEach(() => vi.unstubAllGlobals());

const SAMPLE = { grid: SAMPLE_GRID, ...SAMPLE_SETTINGS };

describe("the check page makes no request", () => {
  it("renders, runs the sample and renders its results with fetch, XMLHttpRequest and sendBeacon throwing", () => {
    stubNetwork();
    expect(() => fetch("/api/anything")).toThrow(/fetch/);

    const page = text(renderToStaticMarkup(createElement(CheckPage)));
    expect(page).toContain("Check a draft grid against your rules");

    const outcome = runCheck(SAMPLE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const html = renderToStaticMarkup(
      createElement(CheckResults, {
        report: outcome.report,
        kept: new Set<string>(),
        onKeep: () => {},
        showAll: false,
        onShowAll: () => {},
        nonce: 1,
      }),
    );
    expect(text(html)).toContain("Rule breaks (4)");

    const whole = text(
      renderToStaticMarkup(
        createElement(ThemeProvider, null, createElement(CheckTool, { initial: SAMPLE, checkOnLoad: true })),
      ),
    );
    expect(whole).toContain("Rule breaks (4)");
  });

  it("makes no request on any route-level path: no stub is called while pasted text is read and drawn", () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (...args: unknown[]) => {
      calls.push(`fetch ${String(args[0])}`);
      throw new Error("fetch");
    });
    vi.stubGlobal("navigator", {
      sendBeacon: (...args: unknown[]) => {
        calls.push(`beacon ${String(args[0])}`);
        throw new Error("beacon");
      },
    });
    const grid = "Secretly Named Act,Hidden Stage,18:00,19:00\nOther Act,Hidden Stage,19:05,20:00";
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(CheckTool, {
          initial: { grid, changeover: "15", curfew: "", pairs: "Secretly Named Act | Other Act" },
          checkOnLoad: true,
        }),
      ),
    );
    expect(text(html)).toContain("Secretly Named Act");
    expect(calls).toEqual([]);
  });
});

describe("the page and its results", () => {
  const html = renderToStaticMarkup(
    createElement(ThemeProvider, null, createElement(CheckTool, { initial: SAMPLE, checkOnLoad: true })),
  );
  const page = text(html);

  it("carries the exact copy: buttons, privacy line, fixed paragraphs and print title", () => {
    expect(page).toContain("Check the grid");
    expect(page).toContain("Load a sample");
    expect(page).toContain("Download a template");
    expect(page).toContain("Draft check, not a verdict");
    expect(page).toContain(
      "Not computed: taste overlap. It needs a Qloo reading per act, and this page makes no request to Qloo or to anything else. The two published days on the home page show what it adds.",
    );
    expect(page).toContain(
      "Rule checks like these also exist in scheduling software. What this app adds is the audience reading on the published days; this page does not have it.",
    );
    expect(page).toContain("Nothing you paste is sent anywhere, saved to this browser or kept after you close or reload this tab.");
  });

  it("lists the four planted breaks, the first 15 pairs and a Show all button", () => {
    const outcome = runCheck(SAMPLE);
    if (!outcome.ok) throw new Error("sample refused");
    const total = outcome.report.shared.length;
    expect(page).toContain("Quiet Voltage is booked on two stages at the same time.");
    expect(page).toContain("Mosaic Syndicate ends at 00:20, after the 00:00 curfew.");
    expect(page).toContain(`Sets that share time (${total} pairs)`);
    expect(page).toContain(`Show all ${total}`);
    expect((html.match(/Kept on purpose/g) ?? []).length).toBe(SHARED_SHOWN);
  });

  it("has a polite live region that is always present and says the counts", () => {
    expect(html).toMatch(/<p role="status" aria-live="polite" class="sr-only">Rule breaks: 4\. Sets that share time: \d+ pairs\.<\/p>/);
  });

  it("gives the first result heading a focus target and the print view its own title", () => {
    expect(html).toMatch(/<h2 id="check-rules-heading" tabindex="-1"/);
    expect(html).toMatch(/hidden[^"]*print:block[^"]*">Draft check, not a verdict</);
  });

  it("says plainly when nothing breaks", () => {
    const outcome = runCheck({ grid: "A,Main,18:00,19:00\nB,Main,19:30,20:30", changeover: "", curfew: "", pairs: "" });
    if (!outcome.ok) throw new Error("refused");
    const clean = text(
      renderToStaticMarkup(
        createElement(CheckResults, {
          report: outcome.report,
          kept: new Set<string>(),
          onKeep: () => {},
          showAll: false,
          onShowAll: () => {},
          nonce: 1,
        }),
      ),
    );
    expect(clean).toContain("Rule breaks (0)");
    expect(clean).toContain("No rule breaks found against the settings above.");
    expect(clean).toContain("Sets that share time (0 pairs)");
  });

  it("marks a kept pair for print and keeps it under the rule breaks", () => {
    const outcome = runCheck(SAMPLE);
    if (!outcome.ok) throw new Error("refused");
    const pair = outcome.report.shared.find(
      (p) => [p.a.act, p.b.act].sort().join("|") === "Copper Circuit|Lunar Roads",
    );
    expect(pair).toBeDefined();
    const withKept = renderToStaticMarkup(
      createElement(CheckResults, {
        report: { ...outcome.report, shared: [pair!, ...outcome.report.shared.filter((p) => p !== pair)] },
        kept: new Set([pair!.id]),
        onKeep: () => {},
        showAll: true,
        onShowAll: () => {},
        nonce: 1,
      }),
    );
    expect(text(withKept)).toContain("Kept by the programmer");
    expect(text(withKept)).toContain("Still listed under rule breaks");
    expect(text(withKept)).toContain("Rule breaks (4)");
    expect(announcement(outcome)).toMatch(/^Rule breaks: 4\./);
  });

  it("HTML-escapes every pasted name", () => {
    const hostile = '<img src=x onerror=alert(1)>,Main,18:00,19:00\n"<script>alert(2)</script>",Side,18:30,19:30';
    const out = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(CheckTool, {
          initial: { grid: hostile, changeover: "", curfew: "", pairs: "<b>x</b> | y" },
          checkOnLoad: true,
        }),
      ),
    );
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<script>alert");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(out).not.toContain("<b>x</b>");
  });

  it("never echoes more than 80 characters of a hostile name, in an error or a result", () => {
    const long = "L".repeat(300);
    const refused = renderToStaticMarkup(
      createElement(CheckTool, {
        initial: { grid: `${long},Main,18:00,19:00`, changeover: "", curfew: "", pairs: "" },
        checkOnLoad: true,
      }),
    );
    expect(refused).toContain('role="alert"');
    expect(withoutFields(refused)).not.toContain("L".repeat(81));
    const pair = renderToStaticMarkup(
      createElement(CheckTool, {
        initial: { grid: "A,Main,18:00,19:00", changeover: "", curfew: "", pairs: `A | ${long}` },
        checkOnLoad: true,
      }),
    );
    expect(pair).toContain('role="alert"');
    expect(withoutFields(pair)).not.toContain("L".repeat(81));
  });
});

// A build-time grep, as a test: the check route's own code holds no network call, no storage and no
// import from the preset API, the preset modules or any hook that fetches.

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const ROUTE_FILES = [
  ...files(join(SRC, "app", "check")),
  ...files(join(SRC, "components", "check")),
  join(SRC, "lib", "check.ts"),
  join(SRC, "lib", "check-sample.ts"),
];

const NETWORK: readonly [string, RegExp][] = [
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["sendBeacon", /sendBeacon/],
  ["WebSocket", /\bWebSocket\b/],
  ["EventSource", /\bEventSource\b/],
  ["Image beacon", /new\s+Image\s*\(/],
  ["navigator", /\bnavigator\./],
  ["localStorage", /localStorage/],
  ["sessionStorage", /sessionStorage/],
  ["indexedDB", /indexedDB/],
  ["cookie", /document\.cookie/],
  ["a URL", /https?:\/\//],
  ["a script tag", /next\/script|<script/],
  ["analytics", /analytics|gtag|plausible|posthog|vercel\/speed/i],
  ["an environment value", /process\.env/],
  ["a form that posts", /<form[^>]*\baction=|method=["']post/i],
];

const ALLOWED_IMPORT =
  /^(react|react-dom|lucide-react|next|@\/components\/ui\/button|@\/lib\/check|@\/lib\/check-sample|@\/lib\/check-flag|@\/lib\/utils|@\/components\/check\/.+|\.\/.+)$/;

describe("the check route holds no network call", () => {
  it("finds the route's files", () => {
    const names = ROUTE_FILES.map((f) => relative(SRC, f).replaceAll("\\", "/"));
    expect(names).toEqual(
      expect.arrayContaining([
        "app/check/page.tsx",
        "components/check/check-tool.tsx",
        "components/check/check-results.tsx",
        "lib/check.ts",
        "lib/check-sample.ts",
      ]),
    );
  });

  for (const [label, pattern] of NETWORK) {
    it(`has no ${label}`, () => {
      const hits = ROUTE_FILES.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
      expect(hits).toEqual([]);
    });
  }

  it("imports nothing from the preset API, the preset modules or a hook that fetches", () => {
    const bad: string[] = [];
    for (const file of ROUTE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
        if (!ALLOWED_IMPORT.test(match[1])) bad.push(`${relative(SRC, file)}: ${match[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("reads only the flag from the layout chain it shares: the layout's own code stores nothing of a paste", () => {
    // The layout (header, footer, banner, theme) is shared with every route. It runs before anything
    // is pasted and has no access to this page's state; the only thing it stores is the theme choice.
    const chain = [
      "app/layout.tsx",
      "components/site/site-header.tsx",
      "components/site/site-footer.tsx",
      "components/site/mock-banner.tsx",
      "components/theme/theme-provider.tsx",
      "components/theme/theme-toggle.tsx",
    ].map((f) => readFileSync(join(SRC, f), "utf8"));
    for (const source of chain) {
      expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon/);
    }
    const stored = chain.join("\n").match(/localStorage\.(?:set|get|remove)Item\(([^)]*)\)/g) ?? [];
    expect(stored.every((call) => /THEME_STORAGE_KEY/.test(call))).toBe(true);
  });
});
