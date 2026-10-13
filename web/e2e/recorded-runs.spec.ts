import { DAYS, requireSavedDays } from "./helpers";
import { expect, test } from "./fixtures";
import { HomePage } from "./pages/home-page";
import { parsePlace, TryAMove } from "./pages/try-a-move";

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

    await expect(home.agent.getByRole("heading", { level: 2 })).toHaveText("Or describe the change in plain words");
    await expect(home.agent).toContainText("The live agent is off here to keep this demo free to run");
    await expect(home.agent).toContainText("Saved runs on this day replay with no live Qloo or model call.");
    await expect(home.agent).toContainText("Prices, clashes and receipts above work without it.");
    await expect(home.agent.getByRole("textbox")).toHaveCount(0);
    await expect(home.agent.getByRole("button", { name: /^(Ask|Send|Run)/ })).toHaveCount(0);
    await expect(home.agent).toContainText("It never changes the real festival, which does not use Clash Control.");
    expect(guard.requested.filter((url) => url.includes("/api/runs"))).toEqual([]);
  });

  test("Glastonbury lists three saved runs, each with its question and what it shows", async ({ page }) => {
    const home = new HomePage(page);
    await home.goto(DAYS.glastonbury.id);

    const runs = home.agent.getByRole("list", { name: "Recorded runs" }).getByRole("listitem");
    await expect(runs).toHaveCount(3);
    await expect(runs.nth(0)).toContainText("Can Nadine Shah play the Other stage at 15:30? Check it against the rules.");
    await expect(runs.nth(0)).toContainText("Ask for a move the rules refuse");
    await expect(runs.nth(1)).toContainText("Ask about an act Qloo knows nothing about");
    await expect(runs.nth(2)).toContainText("Set two rules, then move one set");
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
    // The recorded run made no Qloo request, and says so on its trace button.
    await expect(conversation.getByRole("button", { name: "How Qloo was used, 0 requests" })).toBeVisible();
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
  });
});
