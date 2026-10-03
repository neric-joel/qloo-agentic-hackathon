# Clash Control web app

The Next.js 16 front end for [Clash Control](../README.md) (App Router, React 19, Tailwind v4). It reads a festival day's published timetable and its scores from the backend and shows the decision card, the priced clashes, the Clash Budget Index, Qloo coverage and the request trail, move and rule tests, recorded agent runs, a printable brief and a browser-only grid check. [The live site](https://clash-control.vercel.app) and its [method page](https://clash-control.vercel.app/method) show the product and the limits of its evidence.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The app needs the API: start the backend on port 8000 as the root README describes. With no Qloo key and no presets built, the backend serves one invented day and the page shows a `Synthetic example day: invented acts, no Qloo data` banner above the header.

`next.config.ts` rewrites `/api/:path*` to `${BACKEND_URL}/api/:path*`; `BACKEND_URL` defaults to `http://127.0.0.1:8000`. The browser never receives the Qloo key.

To preview the screens with no backend, set `NEXT_PUBLIC_MOCK_STREAM=1` (PowerShell: `$env:NEXT_PUBLIC_MOCK_STREAM = "1"`). Mock mode uses an invented day and a simulated event stream, makes no request, and shows a `Simulated data` banner. The variable is read at build time; leave it unset in production.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm run start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Next route types and TypeScript |
| `npm test` | Vitest |
| `npm run check` | Lint, typecheck and tests |

Environment variables are listed in `.env.example`: `BACKEND_URL`, `NEXT_PUBLIC_MOCK_STREAM` and `VISITOR_STAMP_SECRET`. The secret signs the caller's address in `src/proxy.ts` for the API's per-visitor caps and must equal the backend's value; left empty, nothing is signed and incoming stamp headers are still removed.

## Pages

| Route | What it shows |
| --- | --- |
| `/` | The first screen is one decision on the published day: the costliest clash with a legal place that lowers the index, the move, the rule line, and the index before and after. Below it: the index, the priced clashes, the timetable, move and rule tests, the agent panel, recorded runs, and where the numbers come from. `?preset=<id>` selects another day. |
| `/brief` | A one-page print view of a day's figures and the kept plan. |
| `/check` | Paste one day of a draft grid and list its rule breaks and shared minutes. It runs in the browser and sends nothing, including to Qloo; it shows no Qloo-derived value for pasted acts. |
| `/method` | How we know: the backtest, the pre-set test that failed, the exploratory follow-up, coverage, and what one live pair check sends. |

## Data boundaries

`GET /api/presets` lists the available days and `GET /api/presets/{id}` returns one: the published timetable, the report, source links and the saved request records, with `synthetic: true` on the invented day. The full overlap matrix stays on the backend. The routes the page also reads, all computed from saved data with no Qloo request:

- `/api/presets/{id}/decision`: the day's worked decision.
- `/api/presets/{id}/lenses`: the costliest clashes ranked with and without taste overlap.
- `/api/presets/{id}/moves` and `POST /api/presets/{id}/whatif`: the legal places for a set, and a stacked plan priced step by step.
- `/api/presets/{id}/rule-fixes`: the rule search for one pair of sets.
- `/api/presets/{id}/recordings`: saved agent runs for replay.

`POST /api/pair` is the live pair check (three Qloo requests; on only when the server operator enables it and a key is set). `POST /api/runs` starts a live agent run and answers 503 while no language-model provider is configured.

Taste overlap is an app-calculated rank out of 100 among the acts on one bill. Qloo returns artist popularity and audience-affinity data, not the page's taste-overlap rank, clash price or Clash Budget Index. Missing Qloo signals are shown as unpriced. Hidden clashes are examples with source links, not detections. A move's new index is calculated with the same measure used to find it. The method page reports the backtest that missed its pre-set bar.

## Structure

| Path | Responsibility |
| --- | --- |
| `src/app/` | Pages (`/`, `/method`, `/brief`, `/check`), layout, global styles, share image |
| `src/components/clash/` | Decision card, timetable, clash drawer, move and keep-apart controls, plan, evidence, agent panel |
| `src/components/check/`, `brief/` | The grid check and the printable brief |
| `src/components/kernel/` | Event-stream state, provenance, trace, recorded and refusal views |
| `src/components/site/` | Header, footer, simulated-data and synthetic-day banners |
| `src/lib/preset.ts`, `decision.ts`, `moves.ts`, `rule-fix.ts` | Validate API payloads; a contract change shows a clear error instead of a broken page |
| `src/lib/check.ts` | The grid parser and the five rule checks, with no network code |
| `src/lib/events.ts`, `sse.ts`, `run-state.ts` | Validate, read and reduce event streams |
| `src/lib/mock-preset.ts`, `mock-stream.ts` | Invented local demo data |
| `src/lib/method-figures.ts` | Every figure printed on `/method`, pinned by a test |

The event-stream client handles chunk boundaries, keep-alive comments, malformed events, connection loss and cancellation. Recorded runs feed the same state reducer as a live stream, with their captured status visible. Provenance components distinguish Qloo-returned values, app calculations and recorded material.

`next.config.ts` disables Next's response compression because local compression can buffer event streams. The backend sends no-transform and buffering headers for streams. The client treats 60 seconds without bytes as a stalled connection.

## Wording and tests

Two scans read every shipped source file: `src/lib/claims-guard.test.ts` rejects wording that treats taste overlap as a count of fans, wording about business or safety effects, and language that presents a move as the best possible one. The backend has a matching scan over its strings and tool output. Tests use invented acts and festivals only; no test or fixture holds Qloo data.

## Accessibility and design

The timetable supports arrow-key navigation, and opening a clash returns focus to its trigger. Status and provenance use words and icons as well as colour. The layout has light, dark and system themes and respects reduced motion. Styling uses Tailwind v4, Radix primitives, Archivo and JetBrains Mono.
