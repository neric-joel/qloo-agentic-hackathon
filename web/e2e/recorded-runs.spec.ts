import { DAYS, pdfPages, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { parsePlace, TryAMove } from "./pages/try-a-move";

/** Said beside a run's zero count when it priced every place it tested with the day's saved reading. */
const SAVED_READING = "Every place it tested was scored with this day’s saved Qloo reading (taste overlap and popularity); it sent no new request.";

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
    await expect(home.agent).toContainText("It can test a move, but it never changes your timetable unless you press Keep this place.");
    await expect(home.agent).toContainText("At most 12 Qloo requests and 6 model turns per run.");
    // The recordings on this day sent no new Qloo request, and the line under the run list says so, and what they
    // scored with (it is computed from the listed runs, so a run that asked Qloo would remove it).
    await expect(home.agent.getByRole("list", { name: "Recorded runs" }).getByRole("listitem")).toHaveCount(3);
    await expect(home.agent).toContainText("These runs send no new Qloo request; they test moves with this day’s saved reading.");
    expect(guard.requested.filter((url) => url.includes("/api/runs"))).toEqual([]);
  });

  test("Glastonbury lists three saved runs, each with its question and what it shows", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    // A run that ends with a place to keep comes first (it is the default replay); the run the rules refuse is last.
    const runs = home.agent.getByRole("list", { name: "Recorded runs" }).getByRole("listitem");
    await expect(runs).toHaveCount(3);
    await expect(runs.nth(0)).toContainText("Keep Jorja Smith and Olivia Rodrigo where they are, and keep Parcels and The Maccabees from overlapping. Then tell me where Parcels could go.");
    await expect(runs.nth(0)).toContainText("Set two rules, then move one set");
    await expect(runs.nth(1)).toContainText("Why do Thandii and The Selecter clash?");
    await expect(runs.nth(1)).toContainText("Ask about an act Qloo knows nothing about");
    await expect(runs.nth(2)).toContainText("Can Nadine Shah play the Other stage at 15:30? Check it against the rules.");
    await expect(runs.nth(2)).toContainText("Ask for a move the rules refuse");
    for (const run of await runs.all()) await expect(run.getByRole("button", { name: /^Replay the recorded run: / })).toBeEnabled();
    // The section is the rail's "Recorded runs".
    await expect(home.railLink("Recorded runs")).toHaveAttribute("href", "#agent");
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
    expect(bestIndex, "the answer prices it").not.toBeNull();

    // The place the agent names is in Try a move's list for the same set, with the same index: one engine
    // behind both. (The run also set a rule between two sets, so Try a move may list a better place.)
    await move.choose("Parcels");
    const listed = (await move.placeLabels()).map(parsePlace);
    const same = listed.find((place) => place.start === best?.[2]);
    expect(same, `Try a move lists Parcels at ${best?.[2]}`).toBeDefined();
    expect(same?.index.toFixed(1)).toBe(bestIndex?.[2]);
  });

  test("Keep this place hands the replayed run's tested place to the plan, and the brief lists it", async ({ page, guard }) => {
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
    // Every place it tested was priced with the day's saved reading, and the run says so beside its zero count.
    await expect(home.agent).toContainText(SAVED_READING);
    await expect(home.agent.getByRole("button", { name: "Qloo requests in this run: 0" })).toBeVisible();
    // With an empty plan there is nothing to add to or replace: one button keeps the place.
    await expect(home.agent.getByRole("button", { name: /^(Add to|Replace) your plan$/ })).toHaveCount(0);

    await home.agent.getByRole("button", { name: "Keep this place" }).click();
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
    test(`after the hero's move is kept, Keep this place offers Add and Replace, and ${choice} says what it did`, async ({ page, guard }) => {
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
});
