import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import CheckPage from "@/app/check/page";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { CHECK_COPY, announcement, runCheck } from "@/lib/check";
import { breakDecisionId, pairDecisionId, pairLabel, type Decision } from "@/lib/check-decisions";
import { parsePriceAnswer, priceRequest, type PriceAnswer, type PriceRequest } from "@/lib/check-price";
import { SAMPLE_GRID, SAMPLE_LABEL, SAMPLE_PLANTED_BREAKS, SAMPLE_SETTINGS, isSampleInput } from "@/lib/check-sample";
import { applyChange, findChange, targetOfBreak, trialSteps } from "@/lib/check-trial";

import { CheckBrief, BRIEF_STALE, snapshotLine } from "./check-brief";
import { DecisionEditor, DecisionList } from "./check-decision";
import { CheckPrice, type PriceState } from "./check-price";
import { CheckResults, RESULT_IDS, SHARED_SHOWN } from "./check-results";
import { CheckReview, comparedLine } from "./check-review";
import { CheckTool } from "./check-tool";
import type { TrialState } from "./check-trial-panel";

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
        decisions: new Map(),
        onDecide: () => {},
        showAll: false,
        onShowAll: () => {},
        nonce: 1,
      }),
    );
    expect(text(html)).toContain("Rule breaks (4)");

    // A search for every break and every pair, a change applied and the results drawn with the search's
    // own panel, with every network stub still throwing.
    for (const item of outcome.report.breaks) {
      const result = findChange(outcome.report, targetOfBreak(item));
      expect(result.changes.length).toBeGreaterThan(0);
      const steps = trialSteps(outcome.report, targetOfBreak(item));
      while (!steps.next().done);
      const state: TrialState = {
        targetId: `break-${item.rule}-${item.rows.join("-")}`,
        label: item.text,
        running: false,
        progress: null,
        result,
      };
      const drawn = renderToStaticMarkup(
        createElement(CheckResults, {
          report: applyChange(outcome.report, result.changes[0]),
          decisions: new Map(),
          onDecide: () => {},
          showAll: false,
          onShowAll: () => {},
          nonce: 1,
          trial: { state, onFind: () => {}, onApply: () => {}, onClose: () => {} },
        }),
      );
      expect(text(drawn)).toContain("Find a change");
    }

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
    expect(page).toContain("Check an invented sample");
    expect(page).toContain("Download a template");
    expect(page).toContain("Draft check, not a verdict");
    expect(page).toContain(CHECK_COPY.elsewhere);
    expect(page).toContain("Rule checks run in your browser; nothing is sent unless you press Compare audience overlap.");
    expect(page).not.toContain("Nothing you paste is sent anywhere");
    expect(page).not.toMatch(/price button/);
    expect(page).toContain("Download CSV");
    expect(page).toContain("Copy share link");
    expect(page).toContain("Anyone with this link can read the grid.");
    expect(page).toContain("Print draft brief");
    expect(page).not.toContain("one-page brief");
  });

  it("offers pricing under the results with the exact words, and no live button before the saved attempt", () => {
    expect(page).toContain("Compare audience overlap (optional)");
    expect(page).not.toContain("Add audience overlap");
    // C2: a saved press sends only the 7 names of the 5 pairs it compares, never the grid's other 17 acts.
    expect(page).toContain(
      "Rule checks used no Qloo data. Compare sends this site’s server the 5 longest movable overlaps and their 7 act names, never times, stages or rules; names are not stored or logged. With no saved day, nothing is compared: live Qloo comparison is off here.",
    );
    // Until the server says live pricing is on, nothing on the page offers to ask Qloo.
    expect(page).not.toContain("you can choose to ask Qloo");
    expect(page).not.toContain("We can ask Qloo now");
    expect(html).toMatch(/<button[^>]*>Compare audience overlap<\/button>/);
    expect(page).not.toMatch(/Price the \d+ longest/);
    expect(page).not.toContain("Ask Qloo for these");
    expect(page).toContain(
      "Each value is a rank within a lineup, not attendance: from a saved day, a rank among that day’s lineup; from Qloo live, a rank among the acts sent. The Clash Budget Index needs a full scored day and is not computed here.",
    );
    expect(page).not.toMatch(/a rank among the acts you pasted/i);
  });

  it("labels the invented sample above the results and on the printed brief, and not a grid of your own", () => {
    const outcome = runCheck(SAMPLE);
    if (!outcome.ok) throw new Error("sample refused");
    expect(outcome.report.sets.length).toBe(25);
    expect(outcome.report.breaks.length).toBe(SAMPLE_PLANTED_BREAKS);
    expect(SAMPLE_LABEL).toBe("Invented sample: 25 sets with four planted rule breaks.");
    // Once on screen (print:hidden) and once on the brief (print only).
    expect(page.split(SAMPLE_LABEL).length - 1).toBe(2);
    expect(html).toContain(`print:hidden">${SAMPLE_LABEL}<`);

    // Any edit to a field clears it: a grid that differs from the sample in one field is not the sample.
    for (const field of ["grid", "changeover", "curfew", "pairs"] as const) {
      expect(isSampleInput({ ...SAMPLE, [field]: `${SAMPLE[field]} ` })).toBe(false);
    }
    const edited = text(
      renderToStaticMarkup(
        createElement(ThemeProvider, null, createElement(CheckTool, { initial: { ...SAMPLE, changeover: "20" }, checkOnLoad: true })),
      ),
    );
    expect(edited).toContain("Rule breaks (");
    expect(edited).not.toContain(SAMPLE_LABEL);

    // The label belongs to the checked snapshot: it is set where a check runs, from what that check
    // read, and no field edit touches it (round-9 regression: an edit used to strip it from a result
    // still on show and from its print).
    const source = readFileSync(join(SRC, "components/check/check-tool.tsx"), "utf8");
    expect(source).not.toMatch(/setSampleActive|sampleActive/);
    expect(source.match(/sample: isSampleInput\(next\)/g)).toHaveLength(1);
    const update = source.slice(source.indexOf("function update("), source.indexOf("function loadSample("));
    expect(update).not.toMatch(/sample/i);
    expect(source).toMatch(/\{run\.sample \? \(/);
    expect(source).toMatch(/sample: run\.sample/);
    // The exported .csv says it is the sample by its name.
    expect(source).toMatch(/csvName\(\{ sample: run\.sample \}\)/);
  });

  it("shows no empty decisions card on screen, keeps the export buttons and prints the zero count", () => {
    const screen = text(withoutFields(html.replace(/<div class="hidden[^"]*print:block[\s\S]*$/, "")));
    expect(html).not.toContain("check-decisions-heading");
    expect(screen).not.toContain("Your decisions (");
    expect(screen).not.toContain("Marks for your team, kept in this tab only.");
    expect(screen).toContain("Download CSV");
    expect(screen).toContain("Print draft brief");
    expect(page).toContain("Your decisions (0) None marked.");
  });

  it("prints a one-page brief with its title, counts, settings, decisions and footer", () => {
    expect(html).toMatch(/hidden[^"]*print:block[^"]*">Draft check, not a verdict</);
    expect(page).toContain("Read 25 sets on 4 stages. Rule breaks: 4. Sets that share time: 35 pairs.");
    expect(page).toContain("Changeover 15 minutes. Curfew 00:00. Never overlap: Saffron Season | Ivory Lights.");
    expect(page).toContain("Your decisions (0)");
    expect(page).toContain("Snapshot: the invented sample as checked.");
    expect(page).toContain("Computed in your browser from the pasted grid.");
    expect(page).not.toContain("a rank among the pasted acts");
  });

  it("lists the four planted breaks, the first SHARED_SHOWN pairs and a Show all button", () => {
    const outcome = runCheck(SAMPLE);
    if (!outcome.ok) throw new Error("sample refused");
    const total = outcome.report.shared.length;
    expect(page).toContain("Orchid Bloom is booked on two stages at the same time.");
    expect(page).toContain("Rustic Harbour ends at 00:20, after the 00:00 curfew.");
    expect(page).toContain(`Sets that share time (${total} pairs)`);
    expect(page).toContain(`Show all ${total}`);
    // A decision for every break and every listed pair.
    expect((html.match(/>Kept on purpose<span class="sr-only">/g) ?? []).length).toBe(4 + SHARED_SHOWN);
    expect((html.match(/>Not changing<span class="sr-only">/g) ?? []).length).toBe(4 + SHARED_SHOWN);
    // Five by default, and "Show all N" reaches every pair in one press.
    expect(SHARED_SHOWN).toBe(5);
    expect(total).toBeGreaterThan(SHARED_SHOWN);
    const all = renderToStaticMarkup(
      createElement(CheckResults, {
        report: outcome.report,
        decisions: new Map(),
        onDecide: () => {},
        showAll: true,
        onShowAll: () => {},
        nonce: 1,
      }),
    );
    expect((all.match(/>Kept on purpose<span class="sr-only">/g) ?? []).length).toBe(4 + total);
    expect(text(all)).toContain(`Sets that share time (${total} pairs)`);
    expect(text(all)).toContain(`Show the ${SHARED_SHOWN} longest`);
  });

  it("puts the sample and template buttons in a row right above the grid, before its help, and keeps the privacy box and the price note open", () => {
    const form = html.slice(0, html.indexOf("</form>"));
    // One control bar above the sheet: the sheet's name, then the three text actions, then the Table / CSV switch.
    expect(form.indexOf("Check an invented sample")).toBeGreaterThan(form.indexOf("Draft grid"));
    expect(form.indexOf("Download a template")).toBeLessThan(form.indexOf('aria-label="Show the draft grid as"'));
    expect(form.indexOf("Check an invented sample")).toBeLessThan(form.indexOf("<textarea"));
    expect(form.indexOf("Check an invented sample")).toBeLessThan(form.indexOf("One set per line"));
    expect(form.indexOf("Download a template")).toBeLessThan(form.indexOf("One set per line"));
    expect(form).toMatch(/<textarea[^>]*rows="8"/);
    // The privacy line sits where the paste happens: under the sheet's name row (after its text actions),
    // above the sheet's switch and the paste field. One copy, one id.
    const privacyAt = form.indexOf(CHECK_COPY.privacy.slice(0, 40));
    expect(privacyAt).toBeGreaterThan(form.indexOf("Check an invented sample"));
    expect(privacyAt).toBeLessThan(form.indexOf('aria-label="Show the draft grid as"'));
    expect(privacyAt).toBeLessThan(form.indexOf("<textarea"));
    expect(html.split("Rule checks run in your browser; nothing is sent unless you press Compare audience overlap.").length - 1).toBe(1);
    const privacyId = /<p id="([^"]+)" class="[^"]*"><svg[^>]*lucide-lock/.exec(form)?.[1];
    expect(privacyId).toBeTruthy();
    expect(html.split(`id="${privacyId}"`).length - 1).toBe(1);
    expect(form).toMatch(new RegExp(`aria-describedby="[^"]*${privacyId}`));
    // The privacy line and the consent text before Compare are never inside a closed disclosure.
    const open = html.replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/g, " ");
    expect(text(open)).toContain(CHECK_COPY.privacy);
    expect(text(open)).toContain("Compare sends this site’s server the 5 longest movable overlaps and their 7 act names");
    expect(text(open)).toContain("Each value is a rank within a lineup, not attendance");
  });

  it("says a decision changes no figure and prints in the brief", () => {
    expect(page).toContain(
      "A decision under a pair or a break is yours: it changes no figure, never removes a rule break above, and prints in the brief under “Your decisions”.",
    );
  });

  it("has a polite live region that is always present and says the counts", () => {
    expect(html).toMatch(/<p role="status" aria-live="polite" class="sr-only">Rule breaks: 4\. Sets that share time: \d+ pairs\.<\/p>/);
  });

  it("gives the first result heading a focus target", () => {
    expect(html).toMatch(/<h2 id="check-rules-heading" tabindex="-1"/);
  });

  it("offers Find a change for each rule break and each listed pair, and none in print", () => {
    const controls = html.match(/<button[^>]*data-find-change=""[^>]*>Find a change<span class="sr-only">/g) ?? [];
    expect(controls).toHaveLength(4 + SHARED_SHOWN);
    // On the same line of controls as the two decisions.
    expect((html.match(/>Not changing<span class="sr-only">[^<]*<\/span><\/button><\/div><span aria-hidden="true"[^>]*><\/span><button[^>]*data-find-change/g) ?? []).length).toBe(
      4 + SHARED_SHOWN,
    );
    expect(page).not.toContain("What this search found");
  });

  it("draws a search result under its break, escapes the names in it and keeps it out of print", () => {
    const hostile = "<img src=x onerror=alert(1)>,Main,18:00,19:00\nB,Main,19:05,20:00\nC,Side,18:00,21:00";
    const outcome = runCheck({ grid: hostile, changeover: "15", curfew: "", pairs: "" });
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    const item = outcome.report.breaks[0];
    const result = findChange(outcome.report, targetOfBreak(item));
    expect(result.changes.length).toBeGreaterThan(0);
    const out = renderToStaticMarkup(
      createElement(CheckResults, {
        report: outcome.report,
        decisions: new Map(),
        onDecide: () => {},
        showAll: false,
        onShowAll: () => {},
        nonce: 1,
        trial: {
          state: {
            targetId: `break-${item.rule}-${item.rows.join("-")}`,
            label: item.text,
            running: false,
            progress: null,
            result,
          },
          onFind: () => {},
          onApply: () => {},
          onClose: () => {},
        },
      }),
    );
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
    const shown = text(out);
    expect(shown).toContain("What this search found");
    expect(shown).toContain("Adds no rule break and makes none larger.");
    expect(shown).toContain("Try it");
    expect(shown).toContain("Searches one or two set moves within this day; locked sets stay put. It uses no audience data and sends nothing.");
    expect(shown).toContain("How the search works One-set moves first, then two-set changes");
    expect(shown).not.toContain("nothing leaves this browser");
    expect(shown).toMatch(/Ends (a|an) \d+-minute overlap with|Ends this rule break|double booking/);
    expect(shown).toMatch(/\d+ found, \d+ shown: each ends it/);
    expect(out).toMatch(/<button[^>]*data-find-change=""[^>]*>Find a change<span class="sr-only">[\s\S]*What this search found/);
    // The plain gloss comes once, under the first change only.
    expect((shown.match(/Other sets may still share time; the grid line below shows the total\./g) ?? []).length).toBe(1);
  });

  it("colours the grid line and adds a warning when a change raises shared time, and only then", () => {
    const outcome = runCheck(SAMPLE);
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    const item = outcome.report.breaks[0];
    const result = findChange(outcome.report, targetOfBreak(item));
    const render = (changes: typeof result.changes) =>
      renderToStaticMarkup(
        createElement(CheckResults, {
          report: outcome.report,
          decisions: new Map(),
          onDecide: () => {},
          showAll: false,
          onShowAll: () => {},
          nonce: 1,
          trial: {
            state: {
              targetId: `break-${item.rule}-${item.rows.join("-")}`,
              label: item.text,
              running: false,
              progress: null,
              result: { ...result, changes, sameStageMore: [] },
            },
            onFind: () => {},
            onApply: () => {},
            onClose: () => {},
          },
        }),
      );
    const raising = result.changes.find((c) => c.sharedAfter.minutes > c.sharedBefore.minutes);
    expect(raising).toBeDefined();
    const risen = render([raising!]);
    expect(risen).toMatch(/text-warning">[^<]*Across the grid:/);
    expect(text(risen)).toContain("Shared time elsewhere rises by");
    const calm: typeof raising = {
      ...raising!,
      sharedRise: 0,
      sharedAfter: raising!.sharedBefore,
    };
    const flat = render([calm]);
    expect(flat).not.toMatch(/text-warning">[^<]*Across the grid:/);
    expect(text(flat)).not.toContain("Shared time elsewhere rises by");
  });

  it("disables Find a change and Try it while the grid or settings differ from the last check", () => {
    const outcome = runCheck(SAMPLE);
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    const item = outcome.report.breaks[0];
    const result = findChange(outcome.report, targetOfBreak(item));
    const render = (stale: boolean) =>
      renderToStaticMarkup(
        createElement(CheckResults, {
          report: outcome.report,
          decisions: new Map(),
          onDecide: () => {},
          showAll: false,
          onShowAll: () => {},
          nonce: 1,
          trial: {
            state: {
              targetId: `break-${item.rule}-${item.rows.join("-")}`,
              label: item.text,
              running: false,
              progress: null,
              result,
            },
            stale,
            onFind: () => {},
            onApply: () => {},
            onClose: () => {},
          },
        }),
      );
    const live = render(false);
    const stale = render(true);
    const find = (html: string) => html.match(/<button[^>]*>Find a change<span/g) ?? [];
    expect(find(live).some((tag) => tag.includes(" disabled=\"\""))).toBe(false);
    expect(find(stale)).toHaveLength(find(live).length);
    expect(find(stale).every((tag) => tag.includes(" disabled=\"\""))).toBe(true);
    const tryIt = (html: string) => html.match(/<button[^>]*>Try it<span/g) ?? [];
    expect(tryIt(live).length).toBeGreaterThan(0);
    expect(tryIt(live).some((tag) => tag.includes(" disabled=\"\""))).toBe(false);
    expect(tryIt(stale).every((tag) => tag.includes(" disabled=\"\""))).toBe(true);
  });

  it("says plainly when nothing breaks", () => {
    const outcome = runCheck({ grid: "A,Main,18:00,19:00\nB,Main,19:30,20:30", changeover: "", curfew: "", pairs: "" });
    if (!outcome.ok) throw new Error("refused");
    const clean = text(
      renderToStaticMarkup(
        createElement(CheckResults, {
          report: outcome.report,
          decisions: new Map(),
          onDecide: () => {},
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

  it("keeps a pair kept on purpose under the rule breaks, offers its reasons and changes no count", () => {
    const outcome = runCheck(SAMPLE);
    if (!outcome.ok) throw new Error("refused");
    const pair = outcome.report.shared.find(
      (p) => [p.a.act, p.b.act].sort().join("|") === "Ivory Lights|Saffron Season",
    );
    expect(pair).toBeDefined();
    const id = pairDecisionId(pair!);
    const decision: Decision = { id, label: pairLabel(pair!), status: "kept", reason: "Contract", note: "", change: null };
    const withKept = renderToStaticMarkup(
      createElement(CheckResults, {
        report: { ...outcome.report, shared: [pair!, ...outcome.report.shared.filter((p) => p !== pair)] },
        decisions: new Map([[id, decision]]),
        onDecide: () => {},
        showAll: true,
        onShowAll: () => {},
        nonce: 1,
      }),
    );
    expect(text(withKept)).toContain("Still listed under rule breaks");
    expect(text(withKept)).toContain("Rule breaks (4)");
    // Decided, the row folds to one line: its mark, Edit, and Find a change still beside it.
    expect(text(withKept)).toContain(`Saffron Season and Ivory Lights · 20 minutes shared Kept on purpose · Contract Edit`);
    expect((withKept.match(/>Kept on purpose<span class="sr-only">/g) ?? []).length).toBe(4 + outcome.report.shared.length - 1);
    expect(withKept).toMatch(/aria-expanded="false"[^>]*>Edit<span class="sr-only">: your decision on Saffron Season and Ivory Lights/);
    expect(announcement(outcome)).toMatch(/^Rule breaks: 4\./);

    // Its reasons and note are one Edit away, with the same chips and the 80-character note.
    const editor = renderToStaticMarkup(createElement(DecisionEditor, { decision, name: "x", onDecide: () => {} }));
    expect(editor).toMatch(/aria-pressed="true"[^>]*>Contract</);
    for (const reason of ["Production", "Travel", "Contract", "Artistic", "Other"]) expect(text(editor)).toContain(reason);
    expect(editor).toMatch(/maxLength="80"/);
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
  join(SRC, "lib", "check-trial.ts"),
  join(SRC, "lib", "check-decisions.ts"),
  join(SRC, "lib", "check-share.ts"),
  join(SRC, "lib", "check-price.ts"),
];

/** The one module of the route that may make a request: the price button's, and only that one call. */
const FETCH_MODULE = join(SRC, "lib", "check-price.ts");
/** The one browser API the route may reach through `navigator`: writing the share link to the clipboard. */
const CLIPBOARD = /\bnavigator\.clipboard\.writeText\(/g;

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

// The two UI primitives the route draws with (a button and the Table / CSV switch) import only React and
// `cn`; neither fetches. `@/lib/lenses` is read by the price module for its parser only (asserted below).
const ALLOWED_IMPORT =
  /^(react|react-dom|lucide-react|next|next\/link|@\/components\/ui\/button|@\/components\/ui\/segmented-control|@\/lib\/check|@\/lib\/check-sample|@\/lib\/check-trial|@\/lib\/check-flag|@\/lib\/check-decisions|@\/lib\/check-share|@\/lib\/check-price|@\/lib\/agent-status|@\/lib\/art|@\/lib\/utils|@\/lib\/lenses|@\/components\/check\/.+|\.\/.+)$/;

describe("the check route holds no network call", () => {
  it("finds the route's files", () => {
    const names = ROUTE_FILES.map((f) => relative(SRC, f).replaceAll("\\", "/"));
    expect(names).toEqual(
      expect.arrayContaining([
        "app/check/page.tsx",
        "components/check/check-tool.tsx",
        "components/check/check-results.tsx",
        "components/check/check-trial-panel.tsx",
        "lib/check.ts",
        "lib/check-sample.ts",
        "lib/check-trial.ts",
        "lib/check-price.ts",
        "components/check/check-price.tsx",
        "components/check/check-brief.tsx",
      ]),
    );
  });

  for (const [label, pattern] of NETWORK) {
    it(`has no ${label}${label === "fetch" ? " outside the price module" : ""}`, () => {
      const hits = ROUTE_FILES.filter((f) => {
        if (label === "fetch" && f === FETCH_MODULE) return false;
        const source = readFileSync(f, "utf8");
        return pattern.test(label === "navigator" ? source.replace(CLIPBOARD, "") : source);
      }).map((f) => relative(SRC, f));
      expect(hits).toEqual([]);
    });
  }

  it("has its fetches in the price module only: the Compare POST, a published day's what-if POST and bodiless GETs of this app's own API", () => {
    const source = readFileSync(FETCH_MODULE, "utf8");
    expect(source.match(/\bfetch\s*\(/g)).toHaveLength(3);
    // The one POST that carries any of a paste: the price body, on the Compare press.
    expect(source).toMatch(/fetch\("\/api\/price-grid", \{/);
    expect(source).toMatch(/body: priceBody\(request, mode\)/);
    // The what-if POST carries rule steps of a published day's public timetable (its ids and start times),
    // never a pasted name: `scoreStepOf` maps each name to the published day's id or makes no step.
    expect(source).toMatch(/fetch\(`\/api\/presets\/\$\{encodeURIComponent\(presetId\)\}\/whatif`, \{/);
    expect(source).toMatch(/body: scoreBody\(steps\)/);
    // The GETs carry no body and read only the health switch and the public timetables, never Qloo.
    const get = source.slice(source.indexOf("async function getJson("), source.indexOf("export async function priceGridLive("));
    expect(get).toMatch(/fetch\(url, \{\s*method: "GET"/);
    expect(get).not.toMatch(/body/);
    const urls = [...new Set([...source.matchAll(/getJson\((["`][^"`]*["`])/g)].map((match) => match[1]))].sort();
    expect(urls).toEqual(
      ['"/api/health"', '"/api/presets"', "`/api/presets/${encodeURIComponent(id)}/lenses?day=${day}`", "`/api/presets/${encodeURIComponent(id)}`"].sort(),
    );
    expect(source).not.toMatch(/qloo\.com|api\.qloo/i);
    const users = ROUTE_FILES.filter((f) => /\brequestPrice\b/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f).replaceAll("\\", "/"));
    expect(users.sort()).toEqual(["components/check/check-tool.tsx", "lib/check-price.ts"]);
    // The press is the only caller: `requestPrice` is reached from the price handler alone.
    const tool = readFileSync(join(SRC, "components", "check", "check-tool.tsx"), "utf8");
    expect(tool.match(/requestPrice\(/g)).toHaveLength(1);
    expect(tool).toMatch(/async function priceIt\(mode: PriceMode\)[\s\S]*?await requestPrice\(sending, mode, controller\.signal\)/);
    // The what-if POST is made from one place, after a Find a change search the visitor started, and only
    // on a published day as loaded here (its ids); nothing on load.
    expect(tool.match(/scoreSteps\(/g)).toHaveLength(1);
    expect(tool).toMatch(/const scoreIds = run\?\.published && published\?\.ids \? published\.ids : null;/);
    expect(tool).toMatch(
      /function scoreListed\([\s\S]*?if \(!scoreIds\) \{[\s\S]*?return;\s*\}[\s\S]*?scoreSteps\(scoreIds\.presetId, plan\.steps, controller\.signal\)/,
    );
    expect(tool.match(/\bscoreListed\(/g)).toHaveLength(2);
    expect(tool).toMatch(/if \(next\.done\) \{[\s\S]*?scoreListed\(next\.value, id, target\);/);
    // The public timetables are read once, after a pasted grid is checked (never the sample, a published day or on load).
    expect(tool.match(/loadServableDays\(/g)).toHaveLength(1);
    expect(tool).toMatch(/const wantServable = run !== null && run\.outcome\.ok && !run\.sample && !run\.published;/);
  });

  it("imports nothing from the preset API, the preset modules or a hook that fetches", () => {
    const bad: string[] = [];
    for (const file of ROUTE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
        if (!ALLOWED_IMPORT.test(match[1])) bad.push(`${relative(SRC, file)}: ${match[1]}`);
      }
    }
    expect(bad).toEqual([]);
    // The lens module is read for its parser alone (the pairs a saved day serves), never its own fetch.
    const lensUsers = ROUTE_FILES.filter((f) => /@\/lib\/lenses/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f).replaceAll("\\", "/"));
    expect(lensUsers).toEqual(["lib/check-price.ts"]);
    expect(readFileSync(FETCH_MODULE, "utf8")).toMatch(/import \{ parseLenses \} from "@\/lib\/lenses";/);
    for (const file of ROUTE_FILES) expect(readFileSync(file, "utf8"), relative(SRC, file)).not.toMatch(/fetchLenses/);
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

describe("round-9 workspace: decisions, recovery, order and review", () => {
  const outcome = runCheck(SAMPLE);
  if (!outcome.ok) throw new Error("sample refused");
  const report = outcome.report;
  const idle: TrialState | null = null;
  const trial = { state: idle, onFind: () => {}, onApply: () => {}, onClose: () => {} };

  it("keeps Find a change on a decided finding, on the row's one line beside Edit", () => {
    const item = report.breaks[0];
    const id = breakDecisionId(item, report.sets);
    const decision: Decision = { id, label: item.text, status: "kept", reason: "Production", note: "Two crews.", change: null };
    const html = renderToStaticMarkup(
      createElement(CheckResults, {
        report,
        decisions: new Map([[id, decision]]),
        onDecide: () => {},
        showAll: false,
        onShowAll: () => {},
        nonce: 1,
        trial,
      }),
    );
    // Round-9 regression: marking a finding used to hide its search.
    expect((html.match(/data-find-change=""/g) ?? []).length).toBe(4 + SHARED_SHOWN);
    expect(text(html)).toContain(`${item.text} Kept on purpose · Production Edit : your decision on ${item.text} Find a change`);
    expect(text(html)).toContain("“Two crews.”");
    // The folded row has no decision buttons and no detail line of its own.
    expect((html.match(/>Kept on purpose<span class="sr-only">/g) ?? []).length).toBe(3 + SHARED_SHOWN);
    expect(text(html)).not.toContain(item.detail);
  });

  it("gives a Changed decision, whose finding the change ended, its reason chips and note in Your decisions", () => {
    const changed: Decision = {
      id: "break:5:x",
      label: "Saffron Season and Ivory Lights share 20 minutes",
      status: "changed",
      reason: null,
      note: "",
      change: "Move Ivory Lights to 18:10–18:55 on Night Tent",
    };
    const list = renderToStaticMarkup(createElement(DecisionList, { decisions: [changed], onDecide: () => {}, defaultOpen: changed.id }));
    for (const reason of ["Production", "Travel", "Contract", "Artistic", "Other"]) {
      expect(list).toMatch(new RegExp(`aria-pressed="false"[^>]*>${reason}<`));
    }
    expect(list).toMatch(/maxLength="80"/);
    expect(text(list)).toContain("Changed Saffron Season and Ivory Lights share 20 minutes: Changed. Move Ivory Lights");
    const closed = renderToStaticMarkup(createElement(DecisionList, { decisions: [changed], onDecide: () => {} }));
    expect(closed).toMatch(/aria-expanded="false"[^>]*>Add a reason<span class="sr-only">/);

    // A chip calls the page's decide with that decision's own id, so the reason lands on it.
    const calls: unknown[][] = [];
    const tree = DecisionEditor({ decision: changed, name: "x", onDecide: (...args) => calls.push(args) });
    const buttons: { props: { children: unknown; onClick: () => void } }[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const el = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
      if (el.type === "button" && el.props?.onClick) buttons.push(el as never);
      walk(el.props?.children);
    };
    walk(tree);
    buttons.find((b) => b.props.children === "Travel")?.props.onClick();
    expect(calls).toEqual([[changed.id, changed.label, { reason: "Travel" }]]);

    // And the edited decision prints in the brief with its reason and note.
    const brief = text(
      renderToStaticMarkup(
        createElement(CheckBrief, { report, applied: [], decisions: [{ ...changed, reason: "Travel", note: "Bus at 19:00" }], price: null }),
      ),
    );
    expect(brief).toContain(
      "Your decisions (1) Saffron Season and Ivory Lights share 20 minutes: Changed. Move Ivory Lights to 18:10–18:55 on Night Tent. Travel: Bus at 19:00",
    );
  });

  it("offers a retry after a failed live answer without a re-check, and explains a cap instead", () => {
    const request = priceRequest(report) as PriceRequest;
    const render = (state: PriceState) =>
      renderToStaticMarkup(
        createElement(CheckPrice, { request, noOverlap: false, state, order: "minutes", onOrder: () => {}, onPrice: () => {}, stale: false }),
      );
    const failedLive = render({ phase: "error", mode: "live" });
    expect(failedLive).toMatch(/<button[^>]*>Try again<span class="sr-only">: Ask Qloo for these 24 acts/);
    expect(text(failedLive)).toContain("The server did not answer, so nothing was compared. Your rule results are unchanged.");
    expect(render({ phase: "error", mode: "saved" })).toMatch(/>Try again<span class="sr-only">: Compare audience overlap/);
    const timedOut = render({ phase: "refused", mode: "live", code: "no_answer", message: "Qloo did not answer in time; nothing was priced." });
    expect(timedOut).toMatch(/>Try again</);
    const capped = render({ phase: "refused", mode: "live", code: "limit", message: "Live pricing has reached today's limit." });
    expect(capped).not.toMatch(/>Try again</);
    expect(text(capped)).toContain("Live pricing has reached today's limit. Try again later. Everything above stays as it is");
    const off = render({ phase: "refused", mode: "live", code: "live_off", message: "Live pricing is switched off on this server." });
    expect(off).not.toMatch(/>Try again</);
    expect(text(off)).toContain("the checks, your decisions, Find a change, the brief and the exports do not need this step");
  });

  it("puts the audience step right after the rule breaks, before the long list, with a jump link above", () => {
    const html = renderToStaticMarkup(createElement(ThemeProvider, null, createElement(CheckTool, { initial: SAMPLE, checkOnLoad: true })));
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(at(RESULT_IDS.rules)).toBeGreaterThan(0);
    expect(at(RESULT_IDS.rules)).toBeLessThan(at(RESULT_IDS.price));
    expect(at(RESULT_IDS.price)).toBeLessThan(at(RESULT_IDS.shared));
    const nav = html.slice(html.indexOf('<nav aria-label="Results"'), html.indexOf("</nav>"));
    expect(nav).toContain(`href="#${RESULT_IDS.rules}"`);
    expect(nav).toContain(`href="#${RESULT_IDS.price}"`);
    expect(nav.indexOf(RESULT_IDS.price)).toBeLessThan(nav.indexOf(RESULT_IDS.shared));
  });

  it("sums the draft up in a review: reviewed, overlaps, compared, changes, kept, not changing, open", () => {
    const html = renderToStaticMarkup(createElement(ThemeProvider, null, createElement(CheckTool, { initial: SAMPLE, checkOnLoad: true })));
    const review = text(html.slice(html.indexOf(`id="${RESULT_IDS.review}"`)));
    expect(review).toMatch(/Draft review 39 open Invented sample 0 \/ 4 rule breaks reviewed/);
    expect(review).toContain("Sets checked 25 on 4 stages");
    expect(review).toContain("Rule breaks 4 · 0 of 4 reviewed");
    expect(review).toContain("Overlaps 35 pairs · 0 decided");
    expect(review).toContain("Compared with Qloo data Not yet Compare audience overlap");
    expect(review).toContain("Changes None tested yet");
    expect(review).toContain("Kept on purpose 0 Not changing 0 Open 4 rule breaks · 35 pairs");
    expect(review).toContain("Print draft brief Copy share link Download CSV Anyone with this link can read the grid.");
    // The sticky rail from lg up; in the flow on a phone.
    expect(html).toMatch(/lg:sticky lg:top-20[^"]*"><section id="check-review"/);

    const request = priceRequest(report) as PriceRequest;
    const answer = parsePriceAnswer(
      {
        mode: "saved",
        source: "invented_day",
        preset_id: "synthetic-lanternfield-friday",
        fetched_at: null,
        coverage: { acts: 24, priced: 24, unpriced: [] },
        pairs: request.overlaps.map((o, i) => ({ a: o.a, b: o.b, status: "priced", taste_overlap: 0.5 - i / 10, pair_rank: i + 1, reason: null })),
        requests_used: 0,
      },
      request,
      "saved",
    ) as PriceAnswer;
    // The invented day is never counted as Qloo data.
    expect(comparedLine({ phase: "ready", answer })).toEqual({ value: "No · invented day, not Qloo data (5 of 5 pairs)", done: true });
    expect(comparedLine({ phase: "ready", answer: { ...answer, source: "saved_day" } }).value).toBe("5 of 5 pairs · saved day, no request now");
    expect(comparedLine({ phase: "ready", answer: { ...answer, mode: "live", source: "qloo_live" } }).value).toBe(
      "5 of 5 pairs · asked Qloo just now",
    );

    const decided = text(
      renderToStaticMarkup(
        createElement(CheckReview, {
          counts: { sets: 25, stages: 4, breaks: 4, breaksReviewed: 4, pairs: 35, pairsDecided: 35, kept: 30, notChanging: 9, changed: 0, openBreaks: 0, openPairs: 0 },
          sample: false,
          price: { phase: "idle" },
          searched: 2,
          applied: 1,
          stale: false,
          onPrint: () => {},
          onCopy: () => {},
          onDownload: () => {},
          canShare: true,
          share: null,
        }),
      ),
    );
    expect(decided).toContain("Every finding decided");
    expect(decided).toContain("Changes 2 tested · 1 applied");
    expect(decided).toContain("Open None");
  });

  it("shows matched, with a signal, no signal, ambiguous and not found as states, and never colours the invented day as Qloo", () => {
    const request = priceRequest(report) as PriceRequest;
    const [p0, p1, p2, p3, p4] = request.overlaps;
    const raw = {
      mode: "saved",
      source: "invented_day",
      preset_id: "synthetic-lanternfield-friday",
      fetched_at: null,
      coverage: { acts: 24, matched: 23, priced: 22, unpriced: [p3.b, p4.b], no_signal: [p4.b], ambiguous: [p3.b] },
      comparator: { kind: "saved_day", acts: 24 },
      pairs: [
        { a: p0.a, b: p0.b, status: "priced", taste_overlap: 0.4, pair_rank: 1, reason: null },
        { a: p1.a, b: p1.b, status: "priced", taste_overlap: 0.3, pair_rank: 2, reason: null },
        { a: p2.a, b: p2.b, status: "priced", taste_overlap: 0.2, pair_rank: 3, reason: null },
        { a: p3.a, b: p3.b, status: "unpriced", taste_overlap: null, pair_rank: null, reason: "ambiguous" },
        { a: p4.a, b: p4.b, status: "unpriced", taste_overlap: null, pair_rank: null, reason: "no_signal" },
      ],
      requests_used: 0,
    };
    const answer = parsePriceAnswer(raw, request, "saved") as PriceAnswer;
    const html = renderToStaticMarkup(
      createElement(CheckPrice, { request, noOverlap: false, state: { phase: "ready", answer }, order: "minutes", onOrder: () => {}, onPrice: () => {}, stale: false }),
    );
    const shown = text(html);
    expect(shown).toContain("Sent 24 Matched 23 With a signal 22 No signal 1 Ambiguous 1");
    expect(shown).not.toContain("Not found");
    expect(shown).toContain(`Not guessed: ${p3.b} matched more than one act of that name, so none was picked.`);
    expect(shown).toContain(`Matched, with no usable signal: ${p4.b}.`);
    expect(shown).toContain("ranks among its invented lineup of 24 acts, not Qloo data and not attendance");
    expect(html).not.toContain("prov-qloo");
  });

  it("labels the snapshot on the brief: invented sample, check time, changes, and a note when the fields moved on", () => {
    expect(snapshotLine({ sample: false, checkedAt: 845, applied: 1 })).toBe(
      "Snapshot: the pasted grid as checked at 14:05, with 1 change applied in a working copy.",
    );
    const brief = text(renderToStaticMarkup(createElement(CheckBrief, { report, applied: [], decisions: [], price: null, sample: true, stale: true })));
    expect(brief).toContain(SAMPLE_LABEL);
    expect(brief).toContain("Snapshot: the invented sample as checked.");
    expect(brief).toContain(BRIEF_STALE);
    // The preview draws the same sheet on screen, on paper colours.
    const preview = renderToStaticMarkup(createElement(CheckBrief, { report, applied: [], decisions: [], price: null, preview: true }));
    expect(preview).not.toMatch(/^<div class="hidden/);
    expect(preview).toContain("--background:#ffffff");
  });
});
