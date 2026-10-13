# Clash Control

Clash Control helps a festival programmer decide which set-time clash is worth moving. It checks a timetable against hard rules (changeovers, curfew, locked sets, pairs that must never overlap), ranks the clashes by time shared, draw (Qloo popularity) and a taste-overlap rank calculated from Qloo audience data, and tests a move against every rule before it prices it.

**Live demo:** [clash-control.vercel.app](https://clash-control.vercel.app) · [Check a draft grid](https://clash-control.vercel.app/check) · [One-page brief](https://clash-control.vercel.app/brief) · [How we know](https://clash-control.vercel.app/method)

Taste overlap is a rank from 0 to 100 among the acts compared for this bill. It is not the share of fans two acts have in common, an attendance estimate or a money figure. The Clash Budget Index is a unitless score, not money: it compares a day's taste-overlap cost with random valid reorderings of the same lineup (100 is their average; lower is better). It is a reading of one measure, not a verdict on a real festival's programming. Neither festival shown uses Clash Control.

## What is saved and what is live

In the code, every feature that calls Qloo or a language model at request time is off unless the deployment's environment switches it on:

| Feature | Default in the code | Switched on by |
| --- | --- | --- |
| Live pair re-check (3 Qloo requests) | Off | `PAIR_CHECK_ENABLED` and a Qloo key |
| Live grid pricing on `/check` (up to 35 Qloo requests) | Off | `PRICE_GRID_ENABLED` and a Qloo key |
| Live agent runs | Off (answers 503) | A configured language-model provider |

With all three off, a visitor sees saved readings of two published festival days, built from saved Qloo responses, and recorded agent runs replayed from saved streams. Each is labelled as saved or recorded on the page. `GET /api/health` reports which live features a deployment has on (`pair_check`, `price_grid_live`, `llm_configured`). Every live feature is capped per visitor and per day, and stops calling Qloo when the month's remaining allowance falls below `QLOO_QUOTA_FLOOR` (1,500 by default).

## What the app does

- **One decision on the first screen.** For a published day, the costliest clash that has a legal place lowering the index: the move, the sets' shared minutes before and after, and the index before and after, with its scale beside it. One line ranks the pair three ways (time alone, time and draw, then with taste overlap), so the reader sees what Qloo's reading changes. **Keep this move** puts the move in the plan and confirms it in place ("Kept in your plan.", with a link to the plan). **Show the working** gives the reasoning, a two-set change that would end the overlap if a rule required it, and the date the saved reading was built.
- **What Qloo changes.** The same clash ranked by time only, by time and draw, and by time, draw and taste, plus the day's two rankings of its costliest clashes with and without taste overlap.
- **Hidden clashes.** Called-out clashes whose acts share no genre tag, with the audience tags Qloo says they share and the source of each complaint. They are examples, not detections.
- **Try a move.** Pick a set; the engine lists every legal start on a 5-minute grid and prices each one. Keep a move to stack the next test on top of it.
- **Keep two sets apart.** Pick two sets that share time. The search covers single places for either set and swaps with one other set, each checked for a new rule break. A change that moves a set to another stage says it needs production sign-off.
- **Recorded agent runs.** Saved runs of the optional agent replay with no Qloo or model call. When a run tested a legal place, **Keep this place** adds it to the plan, and the plan prices it again.
- **One-page brief (`/brief`).** The day's index, its five costliest clashes, the hidden clashes and the kept plan, with a sign-off block, on one printed page. With no plan it shows the first published day and says no moves are kept yet.
- **Check a draft grid (`/check`).** Paste one day of a draft timetable (or load an invented sample, or **Check a published day**) and list its rule breaks and the sets that share time. The rule checks run in your browser. Nothing is sent unless you press **Compare audience overlap**, which sends up to 25 act names and up to five pairs, and nothing else (no times, stages or rules), to this app's server at `POST /api/price-grid`. The server answers from a saved festival day with no Qloo request. Only where `PRICE_GRID_ENABLED` is set can it ask Qloo live, under the caps below. Names are not stored or logged.
- **How we know (`/method`).** What the price is, the backtest against press-flagged clashes (including the pre-set test that failed), the exploratory follow-up, what taste overlap cannot tell you, and the exact parameters of each Qloo request.
- **Live pair re-check.** Where the deployment switches it on, the decision card offers "Re-check this pair with Qloo (3 requests)". It opens the pair's panel, where a second press asks Qloo again and shows the fresh reading beside the saved one, never replacing it.

The backend computes the figures on `/`, `/brief` and in the plan, move and rule routes. `/check` is the exception: its rule checks run in the browser, and it calls the backend only when Compare audience overlap is pressed. Qloo returns popularity and audience affinities; it does not return the taste-overlap rank, the clash price or the index.

## Qloo usage

The code calls three Qloo endpoints and no others, in this order. The API key stays on the backend.

| Endpoint | Parameters sent | Used for |
| --- | --- | --- |
| `GET /search` | `query` (the act's name), `types=urn:entity:artist`, `take=3` | Match each act name to a Qloo artist entity and read its popularity. A similar name is not enough; unmatched acts stay unpriced. |
| `GET /v2/insights` | `filter.type=urn:entity:artist`, `signal.interests.entities` (one act), `filter.results.entities` (the day's other acts, up to 50 per request), `take` (the same count) | Rank the other acts on a bill for one act's audience. The app ranks each row within the day and averages the two directions into taste overlap. |
| `GET /v2/analysis/compare` | `a.signal.interests.entities`, `b.signal.interests.entities` (one act each), `take=50` | Read the taste tags two audiences share (the clash panel, hidden clashes, `explain_clash`, the live re-check). |

`signal.location.query` is not sent for the two published days: they were ranked without a location, so their taste overlap is a global reading, not a local one. The preset builder can send the festival's city with `--location` (off by default).

| Where it happens | Client request records |
| --- | --- |
| Building the Glastonbury 2025 Sunday preset | 104 (45 `/search`, 36 `/v2/insights`, 23 `/v2/analysis/compare`) |
| Building the Riot Fest 2026 Sunday preset | 70 (39 `/search`, 31 `/v2/insights`) |
| One live pair re-check (off unless `PAIR_CHECK_ENABLED`) | 3 requests (two `/v2/insights`, one `/v2/analysis/compare`), private, never retried; capped at 8 per visitor-hour, 20 per visitor-day and 60 a day |
| One live grid price (`/check`, off unless `PRICE_GRID_ENABLED`) | Up to 35 requests (one `/search` per act, one `/v2/insights` per act in a priced pair), private, never retried; capped at 1 per visitor-hour, 2 per visitor-day and 4 a day |
| One `explain_clash` agent tool call | 1 (`/v2/analysis/compare`), only when both acts have a Qloo id |
| Everything else (decision, moves, rule search, plans, brief, `/check` rule checks and saved-day comparison, recorded runs) | 0 |

The preset counts are the lengths of each preset's saved `requests` list: client request records, one per call the build made through the Qloo client. A call answered from the cache may send no HTTP request and a retried call may send several, so a record is not a count of HTTP requests. The live pair re-check's three requests are exact: they are private and retries are off. An agent run is capped at 12 Qloo requests and 6 model turns (`AGENT_MAX_QLOO_CALLS_PER_RUN`, `AGENT_MAX_TURNS`). A generic explore scenario for the agent (`ALLOW_EXPLORE`, off by default) calls `/search` and `/v2/insights` once per lookup within that cap. Qloo's month allowance is shared across all of this, so the live re-check, live grid pricing and the agent's Qloo-backed tools stop calling Qloo below the quota floor.

## Run it locally

Prerequisites: Node.js 22.12 or newer (the version is pinned in `.nvmrc`; `nvm use` picks it up) with npm, and Python 3.12 or newer with [uv](https://docs.astral.sh/uv/). You do not need a Qloo key, an `.env` file or any presets.

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

Open `http://localhost:3000`. The web app proxies `/api/*` to `http://127.0.0.1:8000`. To point it elsewhere, set `BACKEND_URL`. It is read when `next.config.ts` is evaluated: at start-up for `npm run dev`, and at build time for a production build. `npm run start` serves the address that `npm run build` baked in, so set `BACKEND_URL` before you build, not before you start.

**Presets are optional.** A preset is one festival day scored ahead of time. Real presets hold Qloo-derived data, so `backend/presets/` is git-ignored and never committed. When that folder is missing or holds no preset, the API serves one invented day instead, `Lanternfield Friday (synthetic demo)`, flagged `synthetic: true`. The page shows the banner `Synthetic example day: invented acts, no Qloo data`. Its acts, set times, popularity and affinities are generated from a set random seed (`app/schedule/synthetic.py`); no Qloo request is made and nothing on it says anything about a real festival. Every route works on it, including the decision, moves, rule search and plans. The names are random word pairs and could match a real act by chance. To read the day as JSON: `uv run python scripts/make_synthetic_preset.py --out synthetic.json` from `backend/`.

To build a real preset you need a Qloo key in `backend/.env` (copy `backend/.env.example`; the file is git-ignored):

```bash
cd backend
uv run python scripts/build_preset.py glastonbury-2025 Sun --stages main --cache ~/qloo-cache --out presets/glastonbury-2025-sun.json
```

The published timetables the builder reads are in `backend/app/lineups/data/`. Responses are saved to `--cache` first, so rebuilding spends no quota; keep that folder outside the repository. Add `--location` to send the festival's city with each `/v2/insights` request (it is off by default and the shipped days were built without it). Do not commit presets, cached responses or keys.

For a frontend-only preview with a simulated event stream and no backend, run the web app with `NEXT_PUBLIC_MOCK_STREAM=1`. The page labels that mode as simulated.

### Checks

Run from the repository root; each line is its own subshell, so the block can be pasted as it is.

```bash
(cd backend && uv sync --dev && uv run pytest -q && uv run ruff check . && uv run ruff format --check .)
(cd web && npm ci && npm run lint && npm run typecheck && npm test)
node --test scripts/*.test.mjs
```

The backend tests use fakes and `httpx.MockTransport`; none calls Qloo or a model. Tests run on synthetic days and invented values; a claims test also reads the local presets when that folder exists, and a few web tests use public act names as labels. No test holds a Qloo value.

The end-to-end suite (`cd web && npm run e2e`, Playwright) drives a running site; see [web/e2e/README.md](web/e2e/README.md).

### Smoke test

`scripts/smoke.mjs` reads pages and saved presets and sends only requests that are refused before anything is spent; it never reaches Qloo or a model.

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
- `backend/app/qloo/`: the Qloo client (cache, retries, request records, an allowance guard) and the construction of taste overlap from affinity rankings.
- `backend/app/presets.py`, `decision.py`, `whatif.py`, `audit.py`, `pair.py`, `gridprice.py`, `recordings.py`: the read-only API over saved days, plus `POST /api/pair`, `POST /api/price-grid` and `POST /api/presets/{id}/whatif`. The full overlap matrix stays on the server. Computed move and plan answers share caps of 300 per visitor-hour, 1,500 per visitor-day and 5,000 per day (`WHATIF_PER_VISITOR_HOUR`, `WHATIF_PER_VISITOR_DAY`, `WHATIF_PER_DAY` in `backend/app/config.py`); a plan already computed costs nothing to ask again.
- `backend/app/agent/`, `runs.py`: the optional agent and its tools, which call the same engine. Every figure in its result cards comes from the engine; its answer in words is written by a language model and labelled as such.
- `scripts/smoke.mjs`: the deployment smoke test above.
- `web/`: a Next.js 16 app (App Router, Tailwind v4). Pages: `/`, `/method`, `/brief`, `/check`. `next.config.ts` rewrites `/api/*` to the backend; `src/proxy.ts` signs the caller's address for the API's per-visitor caps.

See [web/README.md](web/README.md) for the frontend.

## How we know

The pre-set test failed. Taste overlap put 46.8% of 42 press-flagged clash clusters (68 scored pairs) in the top quarter of their day, against a bar of 60% written down before the test. Its AUC was 0.634, against 0.512 for genre tags and 0.722 for Qloo popularity. Popularity, also a Qloo field, did better. Taste overlap is nearly unrelated to popularity (correlation 0.08 across all concurrent pairs), so it orders a day differently from draw alone; the app uses it as a second opinion beside time and draw. A later label-shuffle check is exploratory: it ran after the test failed, on a press-skewed set, and treats pairs as independent although they come from 42 complaints. The move-suggestion check missed its bar too (7.1 index points against 10).

In an exploratory re-check on the same complaint data (68 complained-about clashes at five festivals), the app's full price, which multiplies Qloo taste overlap by shared minutes and Qloo popularity, scored AUC 0.746 against 0.722 for popularity alone, a difference of +0.024 (95% interval -0.074 to +0.136) that did not establish an advantage over popularity, and it fell to 0.652 on average when taste overlap was shuffled within each day.

The full figures and method are on [How we know](https://clash-control.vercel.app/method). The backtest cannot be rerun from this repository: its complaint set is public (sources are listed on `/method`), but the Qloo responses it scored are Qloo-derived data and are kept outside version control. `web/src/lib/method-figures.ts` holds every figure the page prints, and a test pins each one.

## Limits

- **The pre-set test failed** (above). The result that held is a separate signal from popularity, not a better one.
- **Taste overlap is a rank, not attendance.** It says how alike Qloo ranks two audiences in taste relative to one bill. Acts Qloo has no signal for are left out, never scored as zero; across the five festivals tested, 449 of 624 acts had a usable signal.
- **The shipped days are a global reading.** They were ranked without a location, so they say nothing about a city's own audience.
- **Moves are graded by the measure that found them.** A lower index after a move is expected under that measure and says nothing about a better real timetable. The rule search covers single-set places on a 5-minute grid and two-set changes; longer chains are not searched. Real programmers weigh many constraints this app does not see, and nothing moves until the acts' teams agree.
- **The festivals shown do not use Clash Control.** The two published days are scored from public timetables. Nothing on them is a festival's own data or view.
- **Who would pay is not known.** No festival has used it; the pilot offered on the home page is how that would be found out.
- **Saved Qloo-derived data is not in this repository.** Presets, saved responses and recorded runs are built outside version control.

## License

[MIT](LICENSE).
