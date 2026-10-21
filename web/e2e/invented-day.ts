import fs from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

/**
 * Answers the browser's `/api/presets...` requests with the invented example day (Lanternfield), from the
 * files `fixtures/generate-invented-day.py` wrote with the backend's own generator. The local API serves
 * that day only when it has no built festival days, so this is how the suite reaches it. Only what the
 * invented-day spec presses is answered; anything else is a 404, which the console watch reports. A server with
 * only the invented day has no other day's recordings, so a request for any other day's recordings (which the page
 * should never send there) is answered with no runs, and recorded in `served` so a spec can see it was sent.
 *
 * The pitch above the hero (the lede) is drawn by the server from its own reading of the API, which here serves
 * the published days, so these browser-side answers cannot reach it: the invented lede is pinned in unit tests.
 */

const DIR = path.join(__dirname, "fixtures", "invented-day");

function read<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")) as T;
}

type Step = { act: string; stage_id: string; day: number; start: string };

export type InventedDay = {
  id: string;
  title: string;
  /** The card's own move, as "Keep this move" sends it. */
  cardStep: Step;
  /** Every request answered, as "METHOD path", in order. */
  served: string[];
};

export async function serveInventedDay(page: Page): Promise<InventedDay> {
  const list = read<{ id: string; title: string }[]>("presets.json");
  const preset = read<unknown>("preset.json");
  const decision = read<unknown>("decision.json");
  const lenses = read<unknown>("lenses.json");
  const recordings = read<unknown>("recordings.json");
  const moves = read<Record<string, unknown>>("moves.json");
  const whatif = read<{ step: Step; answer: unknown }>("whatif-card-move.json");
  const { id, title } = list[0];
  const served: string[] = [];

  await page.route(
    (url) => url.pathname === "/api/presets" || url.pathname.startsWith(`/api/presets/${id}`) || /^\/api\/presets\/[^/]+\/recordings$/.test(url.pathname),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      served.push(`${request.method()} ${url.pathname}`);
      const send = (json: unknown) => route.fulfill({ json, headers: { "cache-control": "no-store" } });
      const base = `/api/presets/${id}`;
      if (url.pathname === "/api/presets") return send(list);
      if (url.pathname === base) return send(preset);
      if (url.pathname === `${base}/decision`) return send(decision);
      if (url.pathname === `${base}/lenses`) return send(lenses);
      if (url.pathname === `${base}/recordings`) return send(recordings);
      if (url.pathname.endsWith("/recordings")) return send({ runs: [] });
      if (url.pathname === `${base}/moves`) {
        const answer = moves[url.searchParams.get("act") ?? ""];
        if (answer) return send(answer);
      }
      if (url.pathname === `${base}/whatif` && request.method() === "POST") {
        const body = JSON.parse(request.postData() ?? "{}") as { moves?: Step[]; act?: string | null };
        if (JSON.stringify(body.moves) === JSON.stringify([whatif.step]) && body.act === null) return send(whatif.answer);
      }
      return route.fulfill({ status: 404, json: { detail: "Not in the invented-day fixtures" } });
    },
  );

  return { id, title, cardStep: whatif.step, served };
}
