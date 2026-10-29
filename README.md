# Clash Control

[![ci](https://github.com/neric-joel/qloo-agentic-hackathon/actions/workflows/ci.yml/badge.svg)](https://github.com/neric-joel/qloo-agentic-hackathon/actions/workflows/ci.yml)

Qloo taste data used to schedule, not to recommend: for festival heads of programming, Clash Control ranks set-time clashes by minutes shared, Qloo popularity and a taste overlap rank calculated from Qloo data (a rank, not attendance), and tests a legal move.

**Live:** [clash-control.vercel.app](https://clash-control.vercel.app) · [Check a draft grid](https://clash-control.vercel.app/check) · [One-page brief](https://clash-control.vercel.app/brief?preset=glastonbury-2025-sun&day=0) · [How we know](https://clash-control.vercel.app/method)

**Licence:** MIT, see [LICENSE](LICENSE).

## Judge in 60 seconds

1. Open [Glastonbury 2025, Sunday](https://clash-control.vercel.app/?preset=glastonbury-2025-sun). The drawing shows Sprints 15 minutes later, 45 → 30 min shared with Katy J Pearson, and its cost: "New 15 min overlap with Joy Crookes. Shortens 3 other overlaps by 15 min." Press **Keep this move** and read "Kept in your plan. Nothing moves until the acts’ teams agree." Scroll once to "Adding taste moves this pair from #18 to #1" and its limit, "This does not prove #1 is the right clash to move."
2. On [Check a draft grid](https://clash-control.vercel.app/check), press **Check a published day: Glastonbury 2025, Sunday**, then **Compare audience overlap**. With no Qloo request it prints "Taste overlap changes the order of the 10 compared overlaps: Royel Otis × Djo moves from 10th to 1st." The pairs come from the app's own index: "a worked example, not a test."
3. Open [the brief with that move kept](https://clash-control.vercel.app/brief?preset=glastonbury-2025-sun&day=0&moves=sprints~woodsies~0~1415): one printable page with a sign-off block.
4. Back on Glastonbury 2025, Sunday, scroll to **Agent runs**. Press **Replay** on "Explain a hidden clash and find a move" (the first run listed), then **Skip to the answer** and **Qloo requests in this run: 1** to open "How Qloo was used": one GET `/v2/analysis/compare` with its request id, and "Live when recorded, 20 Oct 2026; replayed now, nothing fetched." On 20 Oct 2026 live questions were switched on for judging too, capped at 2 an hour and 3 a day per visitor and 15 a day in all; GET https://clash-control-api.vercel.app/api/health shows what is on now.

Taste overlap is a rank from 0 to 100 among the acts compared for one bill. It is not a share of people in common, an attendance estimate or a money figure. The Clash Budget Index is a unitless score: 100 is the average random valid timetable of the same lineup, and lower is better. It is a reading of one measure, not a verdict on a real festival's programming. Neither festival shown uses Clash Control.

## What is saved and what is live

Three features can call Qloo or the agent's provider while a visitor uses them. In the code each one is off until the deployment's environment switches it on.

| Feature | In the code (default) | Switched on for judging on 20 Oct 2026 | Switched on by |
| --- | --- | --- | --- |
| Live pair re-check (3 Qloo requests) | Off; when on, 8 per visitor-hour, 20 per visitor-day, 60 a day | On, 8 per visitor-hour, 20 per visitor-day, 60 a day | `PAIR_CHECK_ENABLED` and a Qloo key |
| Live grid compare on `/check` (up to 35 Qloo requests) | Off; when on, 1 per visitor-hour, 2 per visitor-day, 4 a day | On, 1 per visitor-hour, 2 per visitor-day, 4 a day (confirmed 21 Oct 2026) | `PRICE_GRID_ENABLED` and a Qloo key |
| Live agent runs (at most 12 Qloo requests and 6 agent turns a run) | Off (answers 503); when on, 8 per visitor-hour, 20 per visitor-day, 150 a day | On, 2 per visitor-hour, 3 per visitor-day, 15 a day | `LLM_PROVIDER` and a provider key (`backend/app/config.py`) |

On 20 Oct 2026 all three live paths were switched on for judging on https://clash-control.vercel.app: live agent runs capped at 2 per visitor-hour, 3 per visitor-day and 15 a day; the pair re-check at 8 per visitor-hour, 20 per visitor-day and 60 a day; the grid compare at 1 per visitor-hour, 2 per visitor-day and 4 a day (confirmed 21 Oct 2026). On 20 Oct 2026 the live paths were set to stop calling Qloo when fewer than 1,500 requests are left in the month, with the caps counted in memory per server instance. GET https://clash-control-api.vercel.app/api/health shows what is on now.

A local run with the saved days has all three off and shows saved readings and recorded runs, each labelled; a clean clone has no saved days and shows the invented example day under its banner. The health fields are `pair_check`, `price_grid_live` and `llm_configured`; the floor is `QLOO_QUOTA_FLOOR`. The route and its settings keep an older name (price-grid); the feature compares audience overlap and sets no price.

## What the app does

- **The day, drawn, with one move on it.** The first screen draws a published day as one picture: every set at its time on its stage, and the 15 costliest clashes as lines (thicker means a higher taste overlap rank), with the move this app's index picks. On Glastonbury 2025's Sunday that is Sprints 15 minutes later, 45 → 30 min shared with Katy J Pearson, with its cost beside it ("New 15 min overlap with Joy Crookes. Shortens 3 other overlaps by 15 min.") and "Taste overlap: 99 of 100 on this bill (a rank, not attendance)". A toggle shows the day as published. **Keep this move** confirms in place: "Kept in your plan. Nothing moves until the acts’ teams agree." A line above the drawing says what the move respects: "Moves keep stage hours, the latest published end, changeovers and this app’s locks; a clash can be kept on purpose." The key ends "Lock: fixed by this app. Dotted: no Qloo signal."
- **What Qloo changes.** The same pair ranked three ways among the day's 68 scored clashes: time alone #23 (tied with 18 others), time and Qloo popularity #18, with taste overlap from Qloo data #1. The heading reads "Adding taste moves this pair from #18 to #1", and under it: "This does not prove #1 is the right clash to move." Beside it sits the failed test: the test we set before building failed, and popularity did better. Below come the index before and after, a two-set change that would end the overlap, the day's two rankings with and without taste, and a clash that taste lowers ("… #56 with taste: by this index, a candidate to keep."). Where the deployment has `pair_check` on, this section also offers a live re-check of the pair (3 Qloo requests); while it is off, the offer does not show.
- **Hidden clashes.** On the timetable, Hidden marks a clash whose acts' main genre tags differ while their taste overlap is in the top tenth of the bill's scored pairs. The Hidden clashes section shows called-out clashes whose acts share no genre tag, with the audience tags Qloo returns and each complaint's source; the first is Ethel Cain and Geese (Lollapalooza 2026), 8 audience tags in common. They are examples, not detections.
- **The timetable.** The day's clash list, the index and the board's legend stay open: "Board numbers rank clash cost; drawing lines show taste overlap." The board's grid of every set is open on arrival from 1280 px wide; on narrower screens it sits behind one press, "Show 39 sets on 5 stages" on Glastonbury, and it opens by itself when Try a move shows a place on it.
- **Try a move.** Pick a set; every legal start on a 5-minute grid is scored. On Glastonbury a tested place says "Adds no rule break. Checked against this app’s rules for the day, read from the published timetable: each stage’s published hours, nothing after 23:15 (the day’s latest published end), at least 15 min between sets on a stage, sets this app locks, a start within two hours of the set’s published start, on its own stage or a neighbouring one, and pairs that must never overlap." A tested place also says what grows outside its listed clashes ("Outside the listed clashes: new 15 min overlap with Joy Crookes."). Keep a move to stack the next test on it.
- **Keep two sets apart.** For two sets that share time, single places for either set and swaps with one other set, each checked for a new rule break. A change of stage says it needs production sign-off.
- **Recorded agent runs.** The section says what to ask the agent: "Ask it to set rules, find and test a move, then explain the result." Saved runs of the optional agent replay from saved streams; nothing is fetched. Each run's row states its own count ("This run made 1 Qloo request."), and each trace lists the requests its run made when recorded. On Glastonbury, "Explain a hidden clash and find a move", the first run listed, made one `/v2/analysis/compare` request: "Live when recorded, 20 Oct 2026; replayed now, nothing fetched." After a replay, "Qloo requests in this run: 1" sits under the run's question and opens that trace. **Keep this move** adds a run's tested place to the plan, or offers **Add to your plan** (the whole plan is checked first) and **Replace your plan** when the plan already holds steps. Every figure comes from the engine; a language model writes the run's explanations.
- **One-page brief (`/brief`).** The day drawn under the title (as published, or as a kept plan leaves it), the day's index, its five costliest clashes, the hidden clashes and the kept plan, with a sign-off block, on one printed page.
- **Check a draft grid (`/check`).** Paste one day of a draft timetable (or load the invented sample, or **Check a published day**) for its rule breaks and the sets that share time. The rule checks run in your browser; an unreadable line is skipped and listed while the rest are checked. The results header gives that run's time (one run of the sample printed "Checked 25 sets on 4 stages in 1 ms, in this browser."), a measurement of that run, never time saved. Nothing is sent unless you press **Compare audience overlap**, which sends only act names and pairs to this app's server (`POST /api/price-grid`). It answers from a saved festival day with no Qloo request: on a published day, up to 10 of the day's costliest movable clashes, chosen by the app's index, which already includes taste overlap, so the page calls it a worked example, not a test; on a pasted grid, its 5 longest overlaps. Only where `PRICE_GRID_ENABLED` is set can it ask Qloo live, for at most 25 act names and 5 pairs. Names are not stored or logged. To verify, open the browser's network tab and press **Check the grid**: no request is sent.
- **How we know (`/method`).** The score, the backtest against complained-about clashes (including the pre-set test that failed), the exploratory follow-ups, why Qloo rather than a similar-artists list or ticket data, the four control acts, what taste overlap cannot tell you, and every Qloo parameter. A clash's panel on the timetable lists its "Saved requests and values" (each act's `/search` query, the entity this app used, its popularity and its one `/v2/insights` request, and the pair's saved compare where there is one), and [How we know](https://clash-control.vercel.app/method#qloo-calls) draws the chain from act names through the engine to **Keep this move**, with the agent as a branch off the engine that runs only on request; the panel also names Qloo's search match for each act, read from the saved responses, and says why the headline pair has no shared genre tags: its saved compare returned only audience and instrument tags, which this app does not count.

The backend computes the figures on `/`, `/brief` and the plan, move and rule routes; `/check` runs its rule checks in the browser. Qloo returns popularity, audience affinities and tags; the taste overlap rank, the pair score and the index are calculated by this app from Qloo data. The product names no model vendor. Text the agent's language model writes carries an LLM chip: "Written by a language model. Not Qloo data."

## Qloo usage

The code calls three Qloo endpoints and no others, in this order. The API key stays on the backend.

| Endpoint | Parameters sent | Used for |
| --- | --- | --- |
| `GET /search` | `query` (the act's name), `types=urn:entity:artist`, `take=3` | Match each act name to a Qloo artist entity and read its popularity. An exact name match, else a near match at 0.92 similarity; an act with namesakes is marked weak. Unmatched acts are left out, not scored as zero. |
| `GET /v2/insights` | `filter.type=urn:entity:artist`, `signal.interests.entities` (one act), `filter.results.entities` (the day's other acts, up to 50 per request), `take` (the same count) | Rank the other acts on a bill for one act's audience. The app ranks each row within the day and averages the two directions into taste overlap. |
| `GET /v2/analysis/compare` | `a.signal.interests.entities`, `b.signal.interests.entities` (one act each), `take=50` | Read the taste tags two audiences share (the clash panel, hidden clashes, `explain_clash`, the live re-check). |

`signal.location.query` is not sent for the two published days: they were ranked without a location, so their taste overlap is a global reading, not a local one. The preset builder can send the festival's city with `--location` (off by default).

| Where it happens | Client request records |
| --- | --- |
| Building the Glastonbury 2025 Sunday preset | 104 (45 `/search`, 36 `/v2/insights`, 23 `/v2/analysis/compare`) |
| Building the Riot Fest 2026 Sunday preset | 70 (39 `/search`, 31 `/v2/insights`) |
| One live pair re-check (off unless `PAIR_CHECK_ENABLED`) | 3 requests (two `/v2/insights`, one `/v2/analysis/compare`), private, never retried; capped by default at 8 per visitor-hour, 20 per visitor-day and 60 a day |
| One live grid compare (`/check`, off unless `PRICE_GRID_ENABLED`) | Up to 35 requests (at most 25 acts and 5 pairs: one `/search` per act, one `/v2/insights` per act in a compared pair), private, never retried; capped by default at 1 per visitor-hour, 2 per visitor-day and 4 a day |
| One `explain_clash` agent tool call | 1 (`/v2/analysis/compare`), only when both acts have a Qloo id |
| Everything else (moves, rule search, plans, brief, `/check` rule checks and the saved-day comparison, recorded runs) | 0 |

The preset counts are client request records, one per call the build made through the Qloo client; a cached call may send no HTTP request and a retried one several. The pair re-check's three requests are exact (private, no retries). An agent run is capped at 12 Qloo requests and 6 agent turns (`AGENT_MAX_QLOO_CALLS_PER_RUN`, `AGENT_MAX_TURNS`), and live runs by default at 8 per visitor-hour, 20 per visitor-day and 150 a day (switched on for judging on 20 Oct 2026 with 2, 3 and 15: `RUNS_PER_VISITOR_HOUR`, `RUNS_PER_VISITOR_DAY`, `RUNS_PER_DAY`). GET https://clash-control-api.vercel.app/api/health shows what is on now. Every cap is counted in memory per server instance (`backend/app/limits.py`). Qloo's month allowance is shared across all of this, so the live re-check, the live grid compare and the agent's Qloo-backed tools stop calling Qloo below the quota floor.

## Run it locally

Prerequisites: Node.js 22.12 or newer (pinned in `.nvmrc`; `nvm use` picks it up) with npm, and Python 3.12 or newer with uv. You do not need a Qloo key, an `.env` file or any presets.

```bash
# terminal 1: the API
cd backend
uv sync --dev
uv run uvicorn app.main:app --reload --port 8000

# terminal 2: the web app
cd web
npm ci
npm run dev
```

Open `http://localhost:3000`. The web app proxies `/api/*` to `http://127.0.0.1:8000`; to point it elsewhere, set `BACKEND_URL` before `npm run dev` or before a production build (it is read when `next.config.ts` is evaluated).

**Presets are optional.** A preset is one festival day scored ahead of time. Real presets hold Qloo-derived data, so `backend/presets/` is git-ignored and never committed. Without one, the API serves an invented day, `Lanternfield Friday (synthetic demo)`, under the banner `Synthetic example day: invented acts, no Qloo data`. It is generated from a set random seed (`app/schedule/synthetic.py`), makes no Qloo request and works on every route; its names are random word pairs and could match a real act by chance.

To build a real preset you need a Qloo key in `backend/.env` (copy `backend/.env.example`; the file is git-ignored):

```bash
cd backend
uv run python scripts/build_preset.py glastonbury-2025 Sun --stages main --cache ~/qloo-cache --out presets/glastonbury-2025-sun.json
```

The published timetables the builder reads are in `backend/app/lineups/data/`. Responses are saved to `--cache` first, so rebuilding spends no quota; keep that folder outside the repository. Add `--location` to send the festival's city with each `/v2/insights` request. Do not commit presets, cached responses or keys.

For a frontend-only preview with a simulated event stream and no backend, run the web app with `NEXT_PUBLIC_MOCK_STREAM=1`. The page labels that mode as simulated.

## Tests

Run locally on the round-39 working tree on 23 Oct 2026: 2,323 vitest tests in 88 files, 773 pytest tests and 27 script tests passed. The full Playwright run on 23 Oct ran 830 tests across the desktop and phone projects: 788 passed, 1 passed on a retry, 40 skip by design on one project, and 1 failed: a timing test (late agent recordings move nothing on screen) that failed under four parallel workers and passed 3 of 3 run on its own. No test is marked to fail. CI on GitHub runs both jobs on every push and pull request to main; it was green on 867ee7e (23 Oct 2026). The two jobs are the web app's types, unit tests and lint, and the backend tests (`.github/workflows/ci.yml`). A second workflow, browser (invented day) (`.github/workflows/browser.yml`), runs a clean-clone journey on the invented day that fails if any test is skipped; it runs only when started by hand and has not run yet.

Run from the repository root; each line is its own subshell, so the block can be pasted as it is.

```bash
(cd backend && uv sync --dev && uv run pytest -q && uv run ruff check . && uv run ruff format --check .)
(cd web && npm ci && npm run lint && npm run typecheck && npm test)
node --test scripts/*.test.mjs
```

The backend tests use fakes and `httpx.MockTransport`; none calls Qloo or the agent's provider, and no test holds a Qloo value.

The end-to-end suite (`cd web && npm run e2e`, Playwright, both projects) drives a running site; its real-day specs need the saved presets and skip without them. See [web/e2e/README.md](web/e2e/README.md).

### Smoke test

`scripts/smoke.mjs` reads pages and saved presets and sends only requests that are refused before anything is spent; it never reaches Qloo or the agent's provider.

```bash
# a local run or a clean clone (one preset, or only the invented day, is enough; no Qloo key needed)
node scripts/smoke.mjs http://localhost:3000 --api http://localhost:8000 --local

# a deployment, before and after the live pair re-check is switched on
node scripts/smoke.mjs https://<web-origin> --api https://<api-origin> --pair-check off
node scripts/smoke.mjs https://<web-origin> --api https://<api-origin> --pair-check on
```

It prints one line per check and exits 1 when any check fails.

## How it fits together

- `backend/app/schedule/`: the timetable engine. Layout and rule checks, scoring, the Clash Budget Index baseline (random valid timetables), the move search and the rule search.
- `backend/app/qloo/`: the Qloo client (cache, shared in-flight requests, 4.5 requests a second, request records, an allowance guard) and the construction of taste overlap from affinity rankings.
- `backend/app/presets.py`, `decision.py`, `whatif.py`, `audit.py`, `pair.py`, `gridprice.py`, `recordings.py`: the read-only API over saved days, plus `POST /api/pair`, `POST /api/price-grid` and `POST /api/presets/{id}/whatif`. The full overlap matrix stays on the server. Computed move and plan answers share caps of 300 per visitor-hour, 1,500 per visitor-day and 5,000 per day (`WHATIF_PER_VISITOR_HOUR`, `WHATIF_PER_VISITOR_DAY`, `WHATIF_PER_DAY` in `backend/app/config.py`); a plan already computed costs nothing to ask again.
- `backend/app/agent/`, `runs.py`: the optional agent and its seven tools (`list_timetable`, `clash_report`, `explain_clash`, `find_moves`, `try_move`, `add_constraint`, `reslot`), which call the same engine. Among the clash agent's tools, only `explain_clash` sends a Qloo request (one `/v2/analysis/compare`). The general explore tools in `backend/app/agent/qloo_tools.py` are refused unless `ALLOW_EXPLORE` is set, and the page never offers them.
- `scripts/smoke.mjs`: the deployment smoke test above.
- `web/`: a Next.js 16 app (App Router, Tailwind v4). Pages: `/`, `/method`, `/brief`, `/check`. `next.config.ts` rewrites `/api/*` to the backend; `src/proxy.ts` signs the caller's address for the API's per-visitor caps.

See [web/README.md](web/README.md) for the frontend.

## How we know

The pre-set test failed. Taste overlap put 46.8% of 68 complained-about pairs from 42 complaints in the top quarter of their day, against a bar of 60% written down before the test (AUC 0.634, against 0.512 for genre tags and 0.722 for Qloo popularity). Popularity, also a Qloo field, did better. Taste overlap is nearly unrelated to popularity (correlation 0.08), so the app uses it as a second opinion beside time and draw. The move-suggestion check missed its bar too (7.1 index points against 10).

Two follow-ups are exploratory, run after the test failed on the same pairs. The pair score (taste overlap × shared time × Qloo popularity) scored AUC 0.746 against 0.722 for popularity alone, a difference of +0.024 (95% interval -0.074 to +0.136) that did not establish an advantage over popularity. Held at one taste value for every pair, the same score reached 0.754; the pair score minus it is -0.009 (interval -0.102 to +0.079), so this check did not establish that taste adds to time and draw. By festival, adding taste raised the AUC at Glastonbury 2025 by 0.201 (interval 0.111 to 0.277) and lowered it over the four US festivals by 0.065 (interval -0.163 to +0.025).

Each build also looks up four control acts unrelated to a festival bill. On both saved days their mean percentile was 0.35 or lower, the build's own threshold; that checks the signal, not whether the clash rankings are useful.

The figures and method are on [How we know](https://clash-control.vercel.app/method). The backtest cannot be rerun from this repository: its complaint sources are public and listed on `/method`, but the Qloo responses it scored are kept outside version control. `web/src/lib/method-figures.ts` holds every figure the page prints, and a test pins each one.

## Limits

- **The pre-set test failed** (above). The result that held is a separate signal from popularity, not a better one.
- **Taste overlap is a rank, not attendance.** It says how close two audiences are in taste relative to one bill, from Qloo's affinity data. Acts with no Qloo signal are left out, never scored as zero; across the five festivals tested, 449 of 624 acts had a usable signal.
- **The shipped days are a global reading.** They were ranked without a location, so they say nothing about a city's own audience. Asking again for the US festival days with each city would cost 347 Qloo requests.
- **Moves are graded by the measure that found them.** A lower index after a move is expected under that measure and says nothing about a better real timetable. Longer chains than two-set changes are not searched, and real programmers weigh constraints this app does not see.
- **The locks are this app's.** On the published days, the locked sets are the last set on each stage. This app keeps them in place; the festivals did not mark them.
- **The festivals shown do not use Clash Control.** The two published days are scored from public timetables. Nothing on them is a festival's own data or view.
- **Who would pay is not known.** No festival has used it; the pilot on the home page, a walk through the Glastonbury 2025 Sunday brief, is how that would be found out.
- **Saved Qloo-derived data is not in this repository.** Presets, saved responses and recorded runs are built outside version control.
