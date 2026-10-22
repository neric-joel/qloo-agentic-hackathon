import { DAYS, pdfPages, requireSavedDays, stickyBarsFoot } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { parsePlace, TryAMove } from "./pages/try-a-move";

/** Said beside a run's zero count when it scored every place it tested with the day's saved reading. */
const SAVED_READING = "Every place it tested was scored with this day’s saved Qloo reading (taste overlap and popularity); it sent no new request.";

/**
 * The runs line on a day whose runs sent no Qloo request. Both saved days now hold a run that asked Qloo, so it shows
 * on neither, and neither points to the other day's run (the pointer is covered by agent-panel.test.ts).
 */
const RUNS_LINE = "These runs send no new Qloo request; they test moves with this day’s saved reading.";

/** The Riot Fest replay's request row: it reached Qloo live when the run was recorded, and nothing is fetched now. */
const REPLAY_ROW = "Live when recorded, 3 Oct 2026; replayed now, nothing fetched.";

/** The four acts looked up to check that unrelated audiences rank near the bottom of a bill. */
const CONTROL_ACTS = ["Vienna Philharmonic", "Raffi", "Frankie Yankovic", "Mormon Tabernacle Choir"];

/**
 * The agent section on a server with no language model: the live agent is off, and saved runs replay from
 * a recorded stream. A replay is never a live call, so nothing here may reach /api/runs, Qloo or a model.
 */

test.describe("recorded agent runs", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("the live agent is off and says why; there is nothing to type into", async ({ page, guard }) => {
    const health = await (await page.request.get("/api/health")).json();
    test.skip(health.llm_configured === true, "This server has a language model configured; this spec proves the off state.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // Named for what it holds while the agent is off; the invitation to type is gone from the page.
    await expect(home.agent.getByRole("heading", { level: 2 })).toHaveText("Recorded agent runs");
    await expect(page.getByRole("heading", { name: "Or describe the change in plain words" })).toHaveCount(0);
    await expect(home.agent).toContainText("The live agent is off here to keep this demo free to run");
    await expect(home.agent).toContainText("Saved runs on this day replay with no live Qloo or model call.");
    await expect(home.agent).toContainText("Scores, clashes and moves above work without it.");
    await expect(home.agent.getByRole("textbox")).toHaveCount(0);
    await expect(home.agent.getByRole("button", { name: /^(Ask|Send|Run)/ })).toHaveCount(0);
    await expect(home.agent).toContainText("It never changes the real festival, which does not use Clash Control.");

    // What the agent can and cannot do, open with no click, with the run's caps.
    await expect(home.agent.getByRole("heading", { level: 3, name: "What the agent can and cannot do" })).toBeVisible();
    // Round 37: one act, one name (AO4, L34: "Keep this move", as the hero says), and the run's turns are the agent's (R4, L50).
    await expect(home.agent).toContainText("It can test a move, but it never changes your timetable unless you press Keep this move.");
    await expect(home.agent).toContainText("At most 12 Qloo requests and 6 agent turns per run.");
    await expect(home.agent).not.toContainText("Keep this place");
    await expect(home.agent).not.toContainText("model turns");
    // Round 37 (L53): what to ask it, right after what it does, visible with no click.
    await expect(home.agent).toContainText(
      "The agent tests a move against every rule and scores it before it answers. Ask it to set rules, find and test a move, then explain the result. Saved runs on this day replay with no live Qloo or model call.",
    );
    // One recording on this day asked Qloo, and its row says so; the runs line, computed from the listed runs, is gone.
    const runs = home.agent.getByRole("list", { name: "Recorded runs" }).getByRole("listitem");
    await expect(runs).toHaveCount(4);
    await expect(runs.filter({ hasText: "This run made 1 Qloo request." })).toHaveCount(1);
    await expect(home.agent).not.toContainText(RUNS_LINE);
    expect(guard.requested.filter((url) => url.includes("/api/runs"))).toEqual([]);
  });

  test("Glastonbury's run that asked Qloo says so, so it shows no pointer and never asks for Riot Fest's recordings", async ({ page, guard }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // Only the hidden-clash run asked Qloo; every other run says it made none.
    const runs = home.agent.getByRole("list", { name: "Recorded runs" }).getByRole("listitem");
    await expect(runs).toHaveCount(4);
    await expect(runs.filter({ hasText: "This run made 1 Qloo request." })).toHaveCount(1);
    await expect(runs.filter({ hasText: "This run made 1 Qloo request." })).toContainText("Explain a hidden clash and find a move");
    await expect(runs.filter({ hasText: "This run made no Qloo request." })).toHaveCount(3);
    // The day's own run asked Qloo, so there is no pointer to another day's run, and nothing reads Riot Fest's runs.
    await expect(home.agentPointer).toHaveCount(0);
    await expect(home.agent).not.toContainText("asked Qloo while it was recorded");
    expect(guard.requested.filter((url) => new URL(url).pathname === `/api/presets/${DAYS.riot.id}/recordings`)).toEqual([]);
  });

  test("Riot Fest's run asked Qloo, so it shows no pointer and never asks for Glastonbury's recordings", async ({ page, guard }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    await expect(home.agent.getByRole("list", { name: "Recorded runs" }).getByRole("listitem").first()).toContainText("This run made 1 Qloo request.");
    await expect(home.agentPointer).toHaveCount(0);
    await expect(home.agent).not.toContainText("asked Qloo while it was recorded");
    expect(guard.requested.filter((url) => new URL(url).pathname === `/api/presets/${DAYS.glastonbury.id}/recordings`)).toEqual([]);
  });

  test("Glastonbury lists four saved runs, each with its question and what it shows", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // Runs that end with a place to keep come first, the one that asked Qloo first among them (round 37, R2: the first
    // is the default replay); the run the rules refuse is last.
    const runs = home.agent.getByRole("list", { name: "Recorded runs" }).getByRole("listitem");
    await expect(runs).toHaveCount(4);
    await expect(runs.nth(0)).toContainText("Why do Nadine Shah and Gurriers clash, and where could Gurriers go instead?");
    await expect(runs.nth(0)).toContainText("Explain a hidden clash and find a move");
    await expect(runs.nth(0)).toContainText("This run made 1 Qloo request.");
    await expect(runs.nth(1)).toContainText("Keep Jorja Smith and Olivia Rodrigo where they are, and keep Parcels and The Maccabees from overlapping. Then tell me where Parcels could go.");
    await expect(runs.nth(1)).toContainText("Set two rules, then move one set");
    await expect(runs.nth(2)).toContainText("Why do Thandii and The Selecter clash?");
    await expect(runs.nth(2)).toContainText("Ask about an act Qloo knows nothing about");
    await expect(runs.nth(3)).toContainText("Can Nadine Shah play the Other stage at 15:30? Check it against the rules.");
    await expect(runs.nth(3)).toContainText("Ask for a move the rules refuse");
    for (const run of await runs.all()) await expect(run.getByRole("button", { name: /^Replay the recorded run: / })).toBeEnabled();
    // The section is the rail's "Agent runs".
    await expect(home.agentJump).toHaveAttribute("href", "#agent");
  });

  test("replaying a run that the rules refuse: steps, a plain answer, and no live request", async ({ page, guard }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const replay = home.agent.getByRole("button", { name: "Replay the recorded run: Ask for a move the rules refuse" });
    await replay.click();

    // While it plays, the replay buttons are off; it is labelled as recorded, not live.
    await expect(home.agent.getByRole("status").filter({ hasText: /\S/ }).last()).toHaveText(/Replaying a recorded run\.|The recorded run has finished\./);
    const conversation = home.agent.getByRole("list", { name: "Conversation" });
    await expect(conversation).toContainText("The recorded run was asked: Can Nadine Shah play the Other stage at 15:30?");
    await expect(conversation).toContainText("A real agent run, replayed from a saved stream.");
    await expect(conversation).toContainText("nothing here was fetched just now");

    await expect(home.agent.getByRole("status").filter({ hasText: /\S/ })).toHaveText("The recorded run has finished.", { timeout: 25_000 });
    await expect(replay).toBeEnabled();
    await expect(conversation).toContainText("Nadine Shah can't play the Other stage at 15:30");
    await expect(conversation.getByRole("list", { name: "What the agent did" })).toContainText("Tested a move");
    await expect(conversation).toContainText("Ruled out · 1 move");
    await expect(conversation).toContainText("Joy Crookes and Nadine Shah would overlap on the Other stage");
    // The recorded run sent no new Qloo request, and its trace button says so as a count.
    await expect(conversation.getByRole("button", { name: "Qloo requests in this run: 0" })).toBeVisible();
    await expect(conversation.getByRole("button", { name: /^How Qloo was used/ })).toHaveCount(0);
    expect(guard.requested.filter((url) => url.includes("/api/runs"))).toEqual([]);
  });

  test("after a replay ends, the section's heading is clear of the sticky bars by 8 px; on one column the run's question is, with the heading scrolled wholly past", async ({ page, isPhone }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.agent.getByRole("button", { name: "Replay the recorded run: Ask for a move the rules refuse" }).click();
    await expect(home.agent.getByRole("status").filter({ hasText: /\S/ })).toHaveText("The recorded run has finished.", { timeout: 25_000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const foot = await stickyBarsFoot(page);
    const heading = await home.agent.getByRole("heading", { level: 2 }).boundingBox();
    const question = await home.agent.getByRole("list", { name: "Conversation" }).getByRole("listitem").first().boundingBox();
    test.info().annotations.push({ type: `after the replay at ${isPhone ? 390 : 1440}`, description: `bars end ${foot}; heading top ${heading?.y}; question top ${question?.y}` });
    if (!isPhone) {
      // Round 36 (agent lane): the section lands where the "Agent runs" jump lands it, the question beside the heading.
      expect(heading?.y ?? 0, "the heading's top against the bars' foot + 8").toBeGreaterThanOrEqual(foot + 8);
      expect((question?.y ?? 0) + 1, "the run's question is on the screen").toBeLessThan(page.viewportSize()?.height ?? 0);
      // At the page's end the sticky run picker's label stays clear of the bars too.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const label = home.agent.getByText("Watch a recorded run", { exact: true });
      await expect.poll(async () => ((await label.boundingBox())?.y ?? 0) - (await stickyBarsFoot(page)), { message: "the picker's label against the bars' foot" }).toBeGreaterThanOrEqual(8);
    } else {
      // One column: the replay brings the run's question to the top so the answer streams in below it; the heading above
      // it is then wholly scrolled past, never half under the header.
      expect(question?.y ?? 0, "the question's top against the bar's foot + 8").toBeGreaterThanOrEqual(foot + 8);
      expect((heading?.y ?? 0) + (heading?.height ?? 0), "the heading is wholly above the screen").toBeLessThanOrEqual(0);
    }
  });

  test("Skip to the answer finishes a longer run at once, and its numbers are the engine's", async ({ page }) => {
    const home = new HomePage(page);
    const move = new TryAMove(page);
    await home.goto(DAYS.glastonbury.id);

    await home.agent.getByRole("button", { name: /^Replay the recorded run: Set two rules/ }).click();
    await home.agent.getByRole("button", { name: "Skip to the answer" }).click();
    await expect(home.agent.getByRole("status").filter({ hasText: /\S/ })).toHaveText("The recorded run has finished.", { timeout: 15_000 });

    const conversation = home.agent.getByRole("list", { name: "Conversation" });
    await expect(conversation.getByRole("list", { name: "What the agent did" }).getByRole("listitem")).toHaveCount(4);
    await expect(conversation).toContainText("Rule added: Parcels and The Maccabees must not overlap");
    await expect(conversation).toContainText("Where Parcels could go");
    await expect(conversation).toContainText("4 steps");
    const text = await conversation.innerText();
    const best = /Lowest index: (.+) at (\d{2}:\d{2})/.exec(text);
    const bestIndex = /the index goes from (\d+\.\d) to (\d+\.\d)\./.exec(text);
    expect(best, "the answer names the lowest-index place").not.toBeNull();
    expect(bestIndex, "the answer scores it").not.toBeNull();

    // The place the agent names is in Try a move's list for the same set, with the same index: one engine
    // behind both. (The run also set a rule between two sets, so Try a move may list a better place.)
    await move.choose("Parcels");
    const listed = (await move.placeLabels()).map(parsePlace);
    const same = listed.find((place) => place.start === best?.[2]);
    expect(same, `Try a move lists Parcels at ${best?.[2]}`).toBeDefined();
    expect(same?.index.toFixed(1)).toBe(bestIndex?.[2]);
  });

  test("Keep this move hands the replayed run's tested place to the plan, and the brief lists it", async ({ page, guard }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.agent.getByRole("button", { name: /^Replay the recorded run: Set two rules, then move one set/ }).click();
    await home.agent.getByRole("button", { name: "Skip to the answer" }).click();
    await expect(home.agent.getByRole("status").filter({ hasText: /\S/ })).toHaveText("The recorded run has finished.", { timeout: 15_000 });

    // The place comes from the run's own tool result, and nothing is kept until it is pressed.
    const tested = home.agent.getByText(/^Parcels → .+ \d{2}:\d{2}–\d{2}:\d{2}$/);
    await expect(tested).toBeVisible();
    const [, stage = "", start = "", end = ""] = /^Parcels → (.+) (\d{2}:\d{2})–(\d{2}:\d{2})$/.exec((await tested.innerText()).trim()) ?? [];
    await expect(home.plan).toHaveCount(0);
    // Every place it tested was scored with the day's saved reading, and the run says so beside its zero count.
    await expect(home.agent).toContainText(SAVED_READING);
    await expect(home.agent.getByRole("button", { name: "Qloo requests in this run: 0" })).toBeVisible();
    // With an empty plan there is nothing to add to or replace: one button keeps the place.
    await expect(home.agent.getByRole("button", { name: /^(Add to|Replace) your plan$/ })).toHaveCount(0);

    // Round 37 (AO4): the agent's Keep has the hero's name; it is found inside #agent, so the hero's own Keep is not it.
    await expect(home.agent.getByRole("button", { name: "Keep this place" })).toHaveCount(0);
    await home.agent.getByRole("button", { name: "Keep this move" }).click();
    const kept = home.agent.getByRole("status").filter({ hasText: "Kept in your plan." });
    await expect(kept).toBeVisible();
    await expect(kept.getByRole("link", { name: "See your plan" })).toBeFocused();
    const items = home.plan.getByRole("list", { name: "Kept moves" }).getByRole("listitem");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(`1. Parcels · ${stage} ${start}–${end}`);

    // "See your plan" takes focus to the plan.
    await kept.getByRole("link", { name: "See your plan" }).click();
    await expect(home.plan).toBeFocused();

    // The brief made from this plan lists the same move.
    const href = await home.plan.getByRole("link", { name: "Open as a one-page brief" }).getAttribute("href");
    expect(href).toMatch(/^\/brief\?preset=glastonbury-2025-sun&day=0&moves=/);
    await page.goto(href as string, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Parcels");
    await expect(page.getByRole("main")).toContainText(`${start}–${end}`);
    expect(guard.requested.filter((url) => url.includes("/api/runs"))).toEqual([]);
  });

  test("Start over clears the conversation", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.agent.getByRole("button", { name: /^Replay the recorded run: Ask about an act Qloo knows nothing about/ }).click();
    await home.agent.getByRole("button", { name: "Skip to the answer" }).click();
    await expect(home.agent.getByRole("list", { name: "Conversation" })).toContainText("Qloo has no usable audience signal for Thandii");
    await home.agent.getByRole("button", { name: "Start over" }).click();
    await expect(home.agent.getByRole("list", { name: "Conversation" })).toHaveCount(0);
  });

  test("the second day has its own saved run", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.riot.id);

    const runs = home.agent.getByRole("list", { name: "Recorded runs" }).getByRole("listitem");
    await expect(runs).toHaveCount(1);
    await expect(runs.first()).toContainText("Why do Taking Back Sunday and Good Riddance clash");
    await runs.first().getByRole("button", { name: /^Replay the recorded run: / }).click();
    await home.agent.getByRole("button", { name: "Skip to the answer" }).click();
    await expect(home.agent.getByRole("status").filter({ hasText: /\S/ })).toHaveText("The recorded run has finished.", { timeout: 15_000 });
    await expect(home.agent.getByRole("list", { name: "Conversation" })).toContainText("Good Riddance");
    // This run made one Qloo request, so it is never labelled with a zero count or the saved-reading line.
    await expect(runs.first()).toContainText("This run made 1 Qloo request.");
    await expect(home.agent.getByRole("button", { name: "Qloo requests in this run: 0" })).toHaveCount(0);
    await expect(home.agent).not.toContainText(SAVED_READING);

    // Its trace says the request was live when the run was recorded, and that nothing is fetched now: on the request's
    // row, and as the summary's last figure.
    await home.agent.getByRole("button", { name: "Qloo requests in this run: 1" }).click();
    await expect(home.drawer).toBeVisible();
    const row = home.drawer.locator("[data-replay-provenance]");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveText(REPLAY_ROW);
    const summary = await home.drawer
      .locator("dl")
      .first()
      .evaluate((list) => [...list.children].map((part) => (part as HTMLElement).innerText.replace(/\s+/g, " ").trim()).join(" · "));
    expect(summary, "the trace summary").toMatch(/^Requests? 1 · Cached 0 · Recorded 1 · Live when recorded 1$/);
    expect(summary.endsWith(" · Live when recorded 1"), "the summary ends with the live-when-recorded count").toBe(true);
    await page.keyboard.press("Escape");
    await expect(home.drawer).toHaveCount(0);
  });

  test("a run that was not live when recorded never says it was: Glastonbury's replay trace has no live-when-recorded row", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.agent.getByRole("button", { name: "Replay the recorded run: Ask for a move the rules refuse" }).click();
    await home.agent.getByRole("button", { name: "Skip to the answer" }).click();
    await expect(home.agent.getByRole("status").filter({ hasText: /\S/ })).toHaveText("The recorded run has finished.", { timeout: 15_000 });
    await home.agent.getByRole("button", { name: "Qloo requests in this run: 0" }).click();
    await expect(home.drawer).toBeVisible();
    await expect(home.drawer.locator("[data-replay-provenance]")).toHaveCount(0);
    await expect(home.drawer).not.toContainText("Live when recorded");
    await page.keyboard.press("Escape");
  });

  test("the run that tested another set than the hero's says so without naming a card the page no longer has", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.agent.getByRole("button", { name: /^Replay the recorded run: Set two rules, then move one set/ }).click();
    await home.agent.getByRole("button", { name: "Skip to the answer" }).click();
    await expect(home.agent.getByRole("status").filter({ hasText: /\S/ })).toHaveText("The recorded run has finished.", { timeout: 15_000 });
    const conversation = home.agent.getByRole("list", { name: "Conversation" });
    await expect(conversation).toContainText(
      "This run looked for a place for Parcels that lowers the index; the move at the top of the page works on the day’s costliest clash that a move can lower, so their index changes differ.",
    );
    // Nothing on the page names the "decision card" round 34 removed, with every disclosure open.
    await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
    expect(await page.locator("body").innerText()).not.toMatch(/decision card/i);
  });

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, a replay moves nothing on the page once it has started: layout shift after the press is at most 0.01 (1440 light, 390 dark)`, async ({ page, isPhone }) => {
      test.setTimeout(90_000);
      const theme = isPhone ? "dark" : "light";
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      await page.emulateMedia({ colorScheme: theme });
      // A buffered layout-shift observer from navigation; each entry keeps its time and whether input was recent.
      await page.addInitScript(() => {
        const store = window as unknown as { __shifts: { at: number; value: number; input: boolean }[] };
        store.__shifts = [];
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            store.__shifts.push({ at: entry.startTime, value: entry.value, input: entry.hadRecentInput });
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const home = new HomePage(page);
      await home.goto(day.id);
      expect(await home.chrome.appliedTheme()).toBe(theme);

      const replay = home.agent.getByRole("button", { name: /^Replay the recorded run: / }).first();
      await replay.scrollIntoViewIfNeeded();
      const pressed = await page.evaluate(() => performance.now());
      await replay.click();
      // The run plays to its end on its own pacing.
      await expect(home.agent.getByRole("status").filter({ hasText: /\S/ })).toHaveText("The recorded run has finished.", { timeout: 60_000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const shifts = await page.evaluate(() => (window as unknown as { __shifts: { at: number; value: number; input: boolean }[] }).__shifts);
      const after = shifts.filter((entry) => entry.at >= pressed);
      const shift = after.filter((entry) => !entry.input).reduce((sum, entry) => sum + entry.value, 0);
      const withInput = after.reduce((sum, entry) => sum + entry.value, 0);
      test.info().annotations.push({ type: `replay layout shift on ${day.title} at ${isPhone ? "390 dark" : "1440 light"}`, description: `${shift.toFixed(4)} (with entries right after the press: ${withInput.toFixed(4)})` });
      expect(shift, "layout shift after the press, as the browser scores it").toBeLessThanOrEqual(0.01);
    });
  }

  test("How Qloo was used marks the four control acts' lookups, each linking to where they are explained", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.trace.click();
    await expect(home.drawer).toBeVisible();
    const labels = home.drawer.getByRole("link", { name: "control act", exact: true });
    await expect(labels).toHaveCount(CONTROL_ACTS.length);
    for (const label of await labels.all()) {
      await expect(label).toHaveAttribute("href", "/method#controls");
      await expect(label).toHaveAttribute("title", "Looked up to check that unrelated audiences rank near the bottom.");
    }
    // Each label sits after its act's /search query, one per control act.
    const queries = await labels.evaluateAll((all) => all.map((label) => (label.parentElement?.textContent ?? "").replace("control act", "").trim()));
    expect([...queries].sort()).toEqual([...CONTROL_ACTS].sort());
    await page.keyboard.press("Escape");
  });

  test("while a run replays on a wide screen, the column beside it holds the runs and what the agent can do", async ({ page, isPhone }) => {
    test.skip(isPhone, "The two columns sit side by side from 1024 px.");
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    await home.agent.getByRole("button", { name: /^Replay the recorded run: Set two rules, then move one set/ }).click();
    const conversation = home.agent.getByRole("list", { name: "Conversation" });
    await expect(conversation).toBeVisible();
    // Still replaying: Skip to the answer is offered until the run ends.
    const skip = home.agent.getByRole("button", { name: "Skip to the answer" });
    await expect(skip).toBeVisible();
    const run = await conversation.boundingBox();
    const runs = home.agent.getByRole("list", { name: "Recorded runs" });
    for (const beside of [runs, home.agent.getByRole("heading", { level: 3, name: "What the agent can and cannot do" })]) {
      await expect(beside).toBeVisible();
      const box = await beside.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0), "it sits to the left of the run").toBeLessThanOrEqual(run?.x ?? 0);
    }
    // From the can/cannot list down to the runs, the left column shares rows of the page with the run.
    const can = await home.agent.getByRole("heading", { level: 3, name: "What the agent can and cannot do" }).boundingBox();
    const list = await runs.boundingBox();
    const top = Math.max(can?.y ?? 0, run?.y ?? 0);
    const bottom = Math.min((list?.y ?? 0) + (list?.height ?? 0), (run?.y ?? 0) + (run?.height ?? 0));
    expect(bottom - top, "the left column and the run overlap vertically").toBeGreaterThan(0);
    expect(can?.y ?? Infinity, "the left column starts no lower than the run's last row").toBeLessThan((run?.y ?? 0) + (run?.height ?? 0));
    await expect(skip).toBeVisible();
  });

  for (const choice of ["Add to your plan", "Replace your plan"] as const) {
    test(`after the hero's move is kept, the agent's Keep this move offers Add and Replace, and ${choice} says what it did`, async ({ page, guard }) => {
      const home = new HomePage(page);
      const move = new TryAMove(page);
      await home.goto(DAYS.glastonbury.id);

      await home.keepMove.click();
      await expect(move.kept).toHaveCount(1);
      await home.agent.getByRole("button", { name: /^Replay the recorded run: Set two rules, then move one set/ }).click();
      await home.agent.getByRole("button", { name: "Skip to the answer" }).click();
      await expect(home.agent.getByRole("status").filter({ hasText: "The recorded run has finished." })).toBeVisible({ timeout: 15_000 });

      // Never a silent replace: the plan holds a kept move, so both ways are offered, Add first.
      const add = home.agent.getByRole("button", { name: "Add to your plan" });
      const replace = home.agent.getByRole("button", { name: "Replace your plan" });
      await expect(add).toBeVisible();
      await expect(replace).toBeVisible();
      await expect(home.agent.getByRole("button", { name: "Keep this move" })).toHaveCount(0);
      await expect(home.agent.getByRole("button", { name: "Keep this place" })).toHaveCount(0);
      await expect(home.agent).toContainText("your plan already holds 1 kept move.");
      expect(await home.agent.getByRole("button", { name: /^(Add to|Replace) your plan$/ }).allInnerTexts()).toEqual(["Add to your plan", "Replace your plan"]);
      await expect(move.kept).toHaveCount(1);

      await home.agent.getByRole("button", { name: choice }).click();
      const kept = home.agent.getByRole("status").filter({ hasText: "Kept in your plan." });
      await expect(kept).toBeVisible();
      await expect(kept.getByRole("link", { name: "See your plan" })).toBeFocused();
      if (choice === "Add to your plan") {
        await expect(kept).toContainText("Added: 2 kept moves.");
        await expect(move.kept).toHaveCount(2);
        await expect(move.kept.nth(0)).toContainText("1. Sprints · ");
        await expect(move.kept.nth(1)).toContainText("2. Parcels · ");
        // The brief made from this plan lists both moves.
        const href = await move.briefLink.getAttribute("href");
        expect(href).toMatch(/^\/brief\?preset=glastonbury-2025-sun&day=0&moves=.+/);
        await page.goto(href as string, { waitUntil: "domcontentloaded" });
        const plan = page.getByRole("region", { name: "Your plan" });
        await expect(plan).toContainText("2 kept moves: Clash Budget Index ");
        // Each step's visible line starts with its number (the item also holds a print-only decision line).
        await expect(plan.getByRole("listitem").filter({ has: page.getByText(/^1\. Sprints · /) })).toHaveCount(1);
        await expect(plan.getByRole("listitem").filter({ has: page.getByText(/^2\. Parcels · /) })).toHaveCount(1);
        // A brief with two kept moves still prints on one Letter page and one A4 page.
        await page.emulateMedia({ media: "print" });
        for (const format of ["Letter", "A4"] as const) expect(pdfPages(await page.pdf({ format, printBackground: true })), `${format} pages`).toBe(1);
      } else {
        await expect(kept).toContainText("Replaced your 1 kept move.");
        await expect(move.kept).toHaveCount(1);
        await expect(move.kept.first()).toContainText("1. Parcels · ");
      }
      expect(guard.requested.filter((url) => url.includes("/api/runs"))).toEqual([]);
    });
  }

  /** The replay row of each day's run that asked Qloo: live when it was recorded, nothing fetched now. */
  const LIVE_WHEN_RECORDED = {
    [DAYS.glastonbury.id]: "Live when recorded, 20 Oct 2026; replayed now, nothing fetched.",
    [DAYS.riot.id]: REPLAY_ROW,
  } as const;

  for (const day of Object.values(DAYS)) {
    test(`on ${day.title}, the run listed first asked Qloo, and after its replay one ink line under its question says so and opens its trace; on a phone the run's card lands clear of the bars (round 37, R2, L49, L51, L52)`, async ({ page, isPhone, guard }) => {
      const home = new HomePage(page);
      await home.goto(day.id);

      // The first row (and so the default replay) is a run that asked Qloo.
      const runs = home.agent.getByRole("list", { name: "Recorded runs" }).getByRole("listitem");
      await expect(runs.first()).toContainText("This run made 1 Qloo request.");
      await runs.first().getByRole("button", { name: /^Replay the recorded run: / }).click();
      await expect(home.agent.getByRole("status").filter({ hasText: /\S/ }).last()).toHaveText("The recorded run has finished.", { timeout: 60_000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      // One trace line in the section, under the run's question: 14 px, weight 600, in the body's ink.
      const line = home.agent.getByRole("button", { name: /Qloo requests in this run/ }).filter({ visible: true });
      await expect(line).toHaveCount(1);
      await expect(line).toHaveText("Qloo requests in this run: 1");
      const card = home.agent.getByRole("list", { name: "Conversation" }).getByRole("listitem").first();
      await expect(card.locator("[data-run-trace]").getByRole("button")).toHaveText("Qloo requests in this run: 1");
      const style = await line.evaluate((element) => {
        const own = getComputedStyle(element);
        return { size: own.fontSize, weight: own.fontWeight, color: own.color, body: getComputedStyle(document.body).color };
      });
      expect(style.size, "the line's size").toBe("14px");
      expect(style.weight, "the line's weight").toBe("600");
      expect(style.color, "the line is in the body's ink").toBe(style.body);
      const [cardBox, lineBox] = [await card.boundingBox(), await line.boundingBox()];
      expect((lineBox?.y ?? 0) - (cardBox?.y ?? 0), "the line's top within 160 px of the card's top").toBeLessThanOrEqual(160);
      expect(lineBox?.y ?? 0, "the line sits inside the card").toBeGreaterThanOrEqual(cardBox?.y ?? 0);

      if (isPhone) {
        // One column: the card's title row lands under the sticky bars with 8 px to spare, its question in view.
        const foot = await stickyBarsFoot(page);
        expect(cardBox?.y ?? 0, "the card's top against the bars' foot + 8").toBeGreaterThanOrEqual(foot + 8);
        await expect(card.locator("p").filter({ hasText: /^The recorded run was asked: / }).first()).toBeInViewport();
      }

      // It opens the run's trace: live when recorded, nothing fetched now.
      await line.click();
      await expect(home.drawer).toBeVisible();
      await expect(home.drawer.getByRole("heading", { level: 2 })).toHaveText("How Qloo was used");
      await expect(home.drawer.locator("[data-replay-provenance]")).toHaveText(LIVE_WHEN_RECORDED[day.id]);
      await page.keyboard.press("Escape");
      await expect(home.drawer).toHaveCount(0);
      expect(guard.requested.filter((url) => url.includes("/api/runs"))).toEqual([]);
    });
  }
});

/**
 * Round 37 closeout, F3: the agent section's pending state was much shorter than the settled panel, so when Riot
 * Fest's recordings answered late the section grew under a visitor already there (270 -> 611 px at 1440, 403 -> 1,168
 * at 390; 0.19 and 0.73 at CPU 4x) and pushed the sources and the footer off the screen. The section now holds the
 * settled panel's room while the runs are out. Here the recordings are held 2.5 s with the CPU slowed 4x, and every
 * layout shift after the visitor reaches the section, or the page's foot, must stay under 0.0005.
 */
test.describe("recorded agent runs that answer late (round 37 closeout, F3)", () => {
  test.beforeEach(async ({ page }) => requireSavedDays(page));

  test("late recordings move nothing on screen, at the section and at the page's foot, on both days", async ({ page, isPhone }) => {
    test.setTimeout(300_000);
    await page.route(
      (url) => /\/api\/presets\/[^/]+\/recordings$/.test(url.pathname),
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        await route.fallback();
      },
    );
    await page.addInitScript(() => {
      const store = window as unknown as { __shift: number; __shifts: string[]; __watch: boolean };
      store.__shift = 0;
      store.__shifts = [];
      store.__watch = false;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node | null }[] }[]) {
          if (entry.hadRecentInput || !store.__watch) continue;
          const elements = (entry.sources ?? []).map((source) => (source.node instanceof Element ? source.node : (source.node?.parentElement ?? null)));
          store.__shift += entry.value;
          store.__shifts.push(`${entry.value.toFixed(4)}: ${elements.map((element) => (element ? `${element.tagName}${element.id ? `#${element.id}` : ""}` : "?")).join(", ")}`);
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const cdp = await page.context().newCDPSession(page);
    const sizes = isPhone
      ? [
          { width: 390, height: 844 },
          { width: 375, height: 667 },
        ]
      : [
          { width: 1440, height: 900 },
          { width: 1024, height: 768 },
        ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      for (const day of [DAYS.glastonbury, DAYS.riot]) {
        for (const where of ["section", "foot"] as const) {
          const label = `${day.title} at ${size.width} x ${size.height}, visitor at the ${where}`;
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
          // A fresh load each time, so the recordings are asked for (and held) again.
          await page.goto(`/?preset=${day.id}&late=${where}${size.width}`, { waitUntil: "commit" });
          await page.waitForFunction(() => document.getElementById("agent") !== null, null, { timeout: 90_000 });
          await page.evaluate((at) => {
            (window as unknown as { __watch: boolean }).__watch = true;
            if (at === "foot") window.scrollTo(0, document.documentElement.scrollHeight);
            else document.getElementById("agent")?.scrollIntoView({ block: "start" });
          }, where);
          await expect(page.locator("#agent [data-agent-picker]"), `${label}: the runs landed`).toBeAttached({ timeout: 30_000 });
          await page.waitForTimeout(1_000);
          const found = await page.evaluate(() => {
            const store = window as unknown as { __shift: number; __shifts: string[] };
            return { shift: store.__shift, shifts: store.__shifts };
          });
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
          test.info().annotations.push({ type: `late recordings, ${label}`, description: JSON.stringify(found) });
          expect(found.shift, `${label}: layout shift after the recordings landed (${found.shifts.join("; ")})`).toBeLessThan(0.0005);
        }
      }
    }
  });
});
