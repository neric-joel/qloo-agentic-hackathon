# Clash Control web app

The Next.js 16 front end for [Clash Control](../README.md) (App Router, React 19, Tailwind v4). It reads a festival day's published timetable and its scores from the backend and shows the decision card, what Qloo's taste reading changes, hidden clashes, the priced clashes, the Clash Budget Index, Qloo coverage and the request trail, move and rule tests, recorded agent runs, a printable brief and a draft-grid check. [The live site](https://clash-control.vercel.app) and its [method page](https://clash-control.vercel.app/method) show the product and the limits of its evidence.

## Local development

Node.js 22.12 or newer (`engines` in `package.json`; the repository root's `.nvmrc` pins 22.12.0).

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The app needs the API: start the backend on port 8000 as the root README describes. With no Qloo key and no presets built, the backend serves one invented day and the page shows a `Synthetic example day: invented acts, no Qloo data` banner above the header.

`next.config.ts` rewrites `/api/:path*` to `${BACKEND_URL}/api/:path*`; `BACKEND_URL` defaults to `http://127.0.0.1:8000`. The rewrite is fixed when the config is evaluated: at start-up for `npm run dev` and at build time for `npm run build`. `npm run start` serves whatever the build baked in, so set `BACKEND_URL` before building. The browser never receives the Qloo key.

To preview the screens with no backend, set `NEXT_PUBLIC_MOCK_STREAM=1` (PowerShell: `$env:NEXT_PUBLIC_MOCK_STREAM = "1"`). Mock mode uses an invented day and a simulated event stream, makes no request, and shows a `Simulated data` banner. The variable is read at build time; leave it unset in production.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Next route types and TypeScript |
| `npm test` | Vitest |
| `npm run check` | Lint, typecheck and tests |
| `npm run e2e` | Playwright end-to-end suite against a running site (see [e2e/README.md](e2e/README.md)) |

Environment variables are listed in `.env.example`: `BACKEND_URL`, `NEXT_PUBLIC_MOCK_STREAM` and `VISITOR_STAMP_SECRET`. The secret signs the caller's address in `src/proxy.ts` for the API's per-visitor caps and must equal the backend's value; left empty, nothing is signed and incoming stamp headers are still removed.

## Saved and live

The page asks `GET /api/health` which live features the API has on (`pair_check`, `price_grid_live`, `llm_configured`). In the code all three are off unless the deployment's environment switches them on. When they are off, the page shows saved readings and recorded runs, each labelled, and offers no live action: the decision card shows no re-check, `/check` says live Qloo pricing is off, and the agent section replays recorded runs.

## Pages

| Route | What it shows |
| --- | --- |
| `/` | The first screen is one decision on the published day: the costliest clash with a legal place that lowers the index, the move, the index before and after with its scale, and the pair ranked by time alone, by time and draw, and with taste overlap. **Keep this move** adds it to the plan and confirms it in place. Below it, in this order: What Qloo changes, Hidden clashes (on a day that has them), Why this matters, the timetable with the priced clashes and the index, Try a move and Keep two sets apart, Recorded agent runs (each trace labelled with the Qloo requests its run sent, for example "Qloo requests in this run: 0"; **Keep this place** on a run's tested legal place, which offers **Add to your plan** or **Replace your plan** when the plan already holds steps), and Sources. What Qloo changes also names a clash that taste lowers, "a candidate to keep". `?preset=<id>` selects another day. |
| `/brief` | A one-page print view of a day's index, its five costliest clashes, its hidden clashes and the kept plan, with what the readings must not be used for and a sign-off block. With no plan in the address it shows the first published day and says no moves are kept yet. |
| `/check` | Paste one day of a draft grid (or load the invented sample, or **Check a published day**) and list its rule breaks and shared minutes. The rule checks run in the browser with no network code. **Compare audience overlap** is optional: it sends act names and pairs (no times, stages or rules) to `POST /api/price-grid`, which answers from a saved festival day with no Qloo request (up to 60 names and 10 pairs), or from Qloo live only where the API has `PRICE_GRID_ENABLED` (at most 25 names and 5 pairs). On a published day the pairs are up to 10 of the saved day's own costliest clashes that can move, and the page says they are chosen by the app's index, which already includes taste overlap: a worked example, not a test. On a pasted grid they are its 5 longest overlaps. Every pair not compared says why in words. Find a change leaves out, by default, changes that end a clash marked kept on purpose, in a closed list. Decisions stay in the tab; a copied link carries the grid. |
| `/method` | How we know: what the price is, the backtest, the pre-set test that failed, the exploratory follow-ups (among them taste inside the full price, by festival), what taste overlap cannot tell you, the parameters of each Qloo request, and what one live re-check sends. |

## Data boundaries

`GET /api/presets` lists the available days and `GET /api/presets/{id}` returns one: the published timetable, the report, source links and the saved request records, with `synthetic: true` on the invented day. The full overlap matrix stays on the backend. The routes the page also reads, all computed from saved data with no Qloo request:

- `/api/presets/{id}/decision`: the day's worked decision.
- `/api/presets/{id}/lenses`: the costliest clashes ranked with and without taste overlap.
- `/api/presets/{id}/moves` and `POST /api/presets/{id}/whatif`: the legal places for a set, and a stacked plan priced step by step (a step is one move or one listed rule change). They share the server's caps on computed answers: 300 per visitor-hour, 1,500 per visitor-day and 5,000 per day, none for a plan already computed.
- `/api/presets/{id}/rule-fixes`: the rule search for one pair of sets.
- `/api/presets/{id}/recordings`: saved agent runs for replay.
- `POST /api/price-grid` with `mode: "saved"`: `/check`'s comparison against a saved day (up to 60 act names and 10 pairs).

The routes that can reach Qloo or a model, each off unless the deployment switches it on: `POST /api/pair` is the live re-check (three Qloo requests, behind its own press in the clash panel); `POST /api/price-grid` with `mode: "live"` prices a pasted grid (at most 25 acts and 5 pairs, up to 35 Qloo requests; a larger live body is refused); `POST /api/runs` starts a live agent run and answers 503 while no language-model provider is configured.

Taste overlap is an app-calculated rank out of 100 among the acts compared for this bill. Qloo returns artist popularity and audience-affinity data, not the page's taste-overlap rank, clash price or Clash Budget Index. Missing Qloo signals are shown as unpriced. Hidden clashes are examples with source links, not detections. A move's new index is calculated with the same measure used to find it. The method page reports the backtest that missed its pre-set bar.

## Structure

| Path | Responsibility |
| --- | --- |
| `src/app/` | Pages (`/`, `/method`, `/brief`, `/check`), layout, global styles, share image |
| `src/components/clash/` | Decision card, what Qloo changes, hidden clashes, timetable, clash drawer, move and keep-apart controls, plan, evidence, agent panel, recorded runs |
| `src/components/check/`, `brief/` | The grid check and the printable brief |
| `src/components/kernel/` | Event-stream state, provenance, trace, recorded and refusal views |
| `src/components/site/` | Header, footer, opening curtain, simulated-data and synthetic-day banners |
| `src/lib/preset.ts`, `decision.ts`, `moves.ts`, `rule-fix.ts`, `lenses.ts` | Validate API payloads; a contract change shows a clear error instead of a broken page |
| `src/lib/check.ts` | The grid parser and the rule checks, with no network code |
| `src/lib/check-price.ts`, `pair-check.ts`, `agent-status.ts` | The optional comparison request, the live re-check and the API's live-feature switches |
| `src/lib/events.ts`, `sse.ts`, `run-state.ts` | Validate, read and reduce event streams |
| `src/lib/mock-preset.ts`, `mock-stream.ts` | Invented local demo data |
| `src/lib/method-figures.ts` | Every figure printed on `/method`, pinned by a test |
| `src/lib/demand.ts` | What the entry knows about who would use it, the pilot's limits and contact |
| `e2e/` | The Playwright suite and its page objects |

The event-stream client handles chunk boundaries, keep-alive comments, malformed events, connection loss and cancellation. Recorded runs feed the same state reducer as a live stream, with their captured status visible. Provenance components distinguish Qloo-returned values, app calculations and recorded material.

`next.config.ts` disables Next's response compression because local compression can buffer event streams. The backend sends no-transform and buffering headers for streams. The client treats 60 seconds without bytes as a stalled connection.

## Wording and tests

Two scans read every shipped source file. `src/lib/claims-guard.test.ts` rejects wording that treats taste overlap as a count of fans, wording about business or safety effects, and language that presents a move as unbeatable. `src/lib/credit.test.ts` checks that nothing on the invented day credits Qloo. The backend has a matching scan over its strings and tool output. Tests run on synthetic days and invented acts. Two exceptions, neither of which holds a Qloo value: `backend/tests/test_claims.py` also reads the local presets when that folder exists, and a few web tests (`decision.test.ts` among them) use public act names as labels. The end-to-end suite blocks any browser request that could reach Qloo or a model.

## Accessibility and design

The timetable supports arrow-key navigation, and opening a clash returns focus to its trigger. Keeping a move confirms it in place and moves focus to the link to the plan, without scrolling the page. Status and provenance use words and icons as well as colour. The layout has light, dark and system themes, respects reduced motion (the opening curtain is skipped and scrolls are instant) and prints dark ink on white. Styling uses Tailwind v4, Radix primitives, Archivo and JetBrains Mono.
