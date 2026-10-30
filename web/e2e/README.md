# End-to-end tests

The Playwright suite for the Clash Control web app. It drives a real Chromium against a running site and checks what
a visitor sees and can do on the home page, `/check`, `/brief` and `/method`, on screen and in print.

## Running it

Playwright starts the web app for you, but not the API. Start the API first, on port 8000, then run the suite from
a second terminal:

```bash
cd backend && uv run uvicorn app.main:app --port 8000   # first terminal: the API

cd web
npm run e2e                                  # every spec, both projects
npx playwright test --project=phone          # one project
npx playwright test check.spec.ts            # one file
BASE_URL=http://localhost:3100 npm run e2e   # another address
npm run e2e:report                           # open the last HTML report
```

- **Projects.** Every spec runs in two projects: `desktop` (Desktop Chrome at 1440 x 900) and `phone` (Pixel 7 at
  390 x 844, touch). `npx playwright test --list` lists 830 tests in 25 files, 415 per project.
- **The site.** `BASE_URL` defaults to `http://localhost:3000`. When it points at `localhost` or `127.0.0.1`,
  Playwright starts `npm run dev` on that port, or reuses a server already listening there. Any other `BASE_URL` is
  used as it is, and nothing is started.
- **The API.** The web app forwards `/api/*` to `BACKEND_URL` (default `http://127.0.0.1:8000`), so the API must be
  up before the suite starts. Run it with its defaults: no language model (`LLM_PROVIDER` unset or `none`) and
  `PAIR_CHECK_ENABLED` and `PRICE_GRID_ENABLED` off. Four tests that need a live feature off read `/api/health`
  first and skip themselves if it is on.
- **Settings** (`playwright.config.ts`). Tests run fully parallel, with 4 workers locally and 2 in CI, one retry
  locally and two in CI (a test that passes only on a retry is reported as flaky), and 60 s per test. Motion is
  reduced by default; the specs that measure motion turn it back on for themselves. A trace is kept on the first
  retry and a screenshot on failure. Reports go to `playwright-report/` (HTML) and `test-results/junit.xml`.

## Saved festival days

Most specs test the two saved festival days: Glastonbury 2025, Sunday (`glastonbury-2025-sun`) and Riot Fest 2026,
Sunday (`riot-fest-2026-sun`). Their presets hold Qloo-derived data, so they live in `backend/presets/` (the
recorded agent runs in `backend/presets/recordings/`), which is git-ignored and not in the repository.

Without them the API serves only its invented example day, and the tests written for the saved days skip
themselves. Most call `requireSavedDays` from `helpers.ts`, which asks `GET /api/presets` for both days and skips
the test if either is missing; the few that need only one published day check the same list for any. Every spec
file except `invented-day.spec.ts`, `theme.spec.ts` and `method.spec.ts` uses `requireSavedDays`. On a clean clone
those tests are reported as skipped, not failed.

## The invented day and the browser workflow

`invented-day.spec.ts` tests the invented example day (Lanternfield) even when the API serves the saved days:
`invented-day.ts` answers the browser's `/api/presets…` requests from the JSON files in `fixtures/invented-day/`.
`fixtures/generate-invented-day.py` wrote them with the backend's own generator (seed 7, 24 acts, no Qloo key, no
model). Rerun it from the repository root, with the backend's interpreter (`backend/.venv/bin/python` outside
Windows), only when the API's answers change shape:

```bash
backend/.venv/Scripts/python.exe web/e2e/fixtures/generate-invented-day.py
```

The lede above the hero is rendered by the web server from its own reading of the API, which these browser-side
answers cannot reach, so the invented day's lede is checked in a unit test,
`web/src/components/site/synthetic-trust.test.ts`.

`.github/workflows/browser.yml` runs part of the suite on a clean clone. It is started by hand only (Actions,
"browser (invented day)", Run workflow), never by a push or a pull request. It:

1. starts the API with no presets, no secrets and `LLM_PROVIDER=none`, and stops unless `/api/health` and
   `/api/presets` report the invented day only, with no Qloo key and every live switch off;
2. runs `invented-day.spec.ts`, `theme.spec.ts` and `check.spec.ts` in both projects, leaving out by title the
   `/check` tests named "Check a published day" (122 tests listed for that selection);
3. fails the job, through `.github/scripts/journey-gate.mjs`, if any test was skipped or fewer than
   `JOURNEY_MINIMUM` passed;
4. then, outside the Playwright runner, checks the hero when the server has no decision to draw:
   `.github/scripts/decision-stub.mjs` sits between a second web server and the API, removes the decision from the
   day's answer and holds the decision request past the server's 4 s wait, and `.github/scripts/hero-fallback.cjs`
   compares the hero's first frame with its settled frame at 1440 x 900 and 390 x 844 with the CPU slowed 4x.

## What no test can reach

`fixtures.ts` exports the `test` every spec uses. For each test it routes every request made in the test's browser
context:

- A request to any host other than `localhost`, `127.0.0.1`, `[::1]` or the host in `BASE_URL` is aborted before it
  leaves the browser.
- A request that could reach Qloo or a language model is aborted too: any path under `/api/pair`, `/api/runs`,
  `/api/baseline` or `/api/agent`, and `/api/price-grid` unless its body says `mode: "saved"`.
- Both kinds are recorded, and the test fails afterwards if either list is not empty.
- Any other request to `/api/` with a method other than GET fails the test, unless it is the engine's what-if
  (`POST /api/presets/{id}/whatif`, sent by Keep, Add or Replace) or a saved-mode compare (`POST /api/price-grid`).

A spec's own `page.route` handlers run before the guard. A request a spec answers itself never leaves the browser,
and what it passes on with `route.fallback()` meets the guard. Three handlers fetch the real answer to a GET and
change it before the page sees it (`/api/presets` in `check.spec.ts`, a day under `/api/presets/` in `hero.spec.ts`,
`/api/health` in `recorded-runs.spec.ts`). Outside the browser, the test process sends a few requests itself with
`page.request` (GETs to `/api/health`, `/api/presets`, `/api/presets/{id}` and pages, and one
`POST /api/presets/{id}/whatif` in `HomePage.answerKeepAtOnce`), and the web server reads the day list, the day and
its decision while it renders a page. None of those routes calls Qloo or a model: they read saved files or run the
scheduling engine. One test in `hero.spec.ts` opens a separate context with scripts turned off to read the server's
HTML, so that page sends no API request. `network-safety.spec.ts` tests the guard itself.

The same fixture fails a test on any console error or uncaught page error, unless the spec names the one it expects
(a page meant to 404 uses `test.use({ ignoreConsole: [/status of 404/] })`), and provides `isPhone`, true below
640 px wide.

## Helpers and page objects

- `pages/home-page.ts`, `pages/check-page.ts`, `pages/site-chrome.ts`: page objects. Locators go by role and
  accessible name, plus `data-` attributes the app already sets on its drawing and hero (for example
  `data-hero-group` and `data-day-graph`); the suite uses no `data-testid`. `HomePage.goto()` returns once the
  interactive page has replaced the server's frame and the webfont has loaded, and `CheckPage.goto()` once the page
  has hydrated. The board's grid sits in a disclosure that arrives open from 1280 px wide and closed below, so specs
  call `openBoard()` or `closeBoard()` before reading it.
- `helpers.ts`: the two saved days (`DAYS`), `requireSavedDays`, the two lines the site must always show, and
  shared measurements (sideways scroll, visible text, the sticky bars' foot).
- `invented-day.ts`: the invented day served from fixtures, described above.

## Spec files

| File | What it covers |
| --- | --- |
| `home.spec.ts` | Home on each saved day: what loads, the lede in the server's HTML, the index card's starting score, switching days, page-height ceilings (6,400 px at 1440 with the board closed, 10,900 px at 390) |
| `hero.spec.ts` | The decision group at the top of the home page: the move, Keep this move with Add or Replace, the server's first frame and the group's steady height while the decision loads, the desktop note, the date line, the ladder |
| `day-graph.spec.ts` | The drawing of the day: names whole and nearest their own bars, leaders, line notes by keyboard, no layout shift, the hero's word budget, Keep's position on small phones, the toggle's 450 ms move, no sideways scroll from 320 to 1440 px |
| `timetable.spec.ts` | The board: its marks and key, coverage, the costliest clashes and the clash drawer, the board's disclosure, the wording on locked sets, arrow-key movement |
| `hidden-clashes.spec.ts` | Hidden clashes: the sourced examples, stepping through them by keyboard, the day's own hidden pair, "Hidden" in ink |
| `try-a-move.spec.ts` | Try a move: legal places, re-pricing, keep, undo and start over, the eight-move limit, a plan that survives a reload, late answers that move nothing |
| `keep-apart.spec.ts` | Keep two sets apart: the costliest pair, previews on the board, keeping a change |
| `recorded-runs.spec.ts` | Recorded agent runs with the live agent off: the list, replay, Skip to the answer, Keep this move into the plan and the brief, no layout shift during a replay; the note on the agent's limits, with `/api/health` changed in the browser only to report a model configured, and nothing asked |
| `sections.spec.ts` | The home page's sections on what Qloo changes, who has complained, what is not known, and sources |
| `honesty.spec.ts` | "A reading, not a verdict." and "Neither festival uses Clash Control." on both days and after a move, a day switch and a theme change; the move's caveats on the first screen and in the brief; no "price" wording |
| `rail.spec.ts` | The section rail: order, the current section, staying under the header, one sideways row on a phone |
| `navigation.spec.ts` | Header, footer, the phone menu, the skip link, the section nav's "Agent runs" link, 404 pages |
| `keyboard.spec.ts` | Keyboard paths and focus rings: the first screen, the clash drawer, the day tabs, the drawing's lines, disclosures, `/check` |
| `check.spec.ts` | `/check`: the invented sample, rule breaks, shared time, rule settings, pasted grids in many formats, refusals and skipped lines, decisions, Find a change, CSV downloads and share links, the printed draft brief, checking a published day |
| `check-price.spec.ts` | Compare audience overlap on `/check`: answered from a saved day in saved mode only, a skipped line's act never sent, no live offer while it is switched off |
| `brief.spec.ts` | `/brief`: with and without a plan, the day's figure, one Letter page and one A4 page in print, an unknown day |
| `print.spec.ts` | Print media for the home page, `/method` and `/check`'s draft brief: dark ink on paper in either theme |
| `method.spec.ts` | `/method`: the failed test and its table, the Qloo endpoints and what each sends, the chain from request to decision, sources, the contents links |
| `invented-day.spec.ts` | The invented day: says it is invented and credits no Qloo, its board's wording, its move and legal places through the same engine |
| `theme.spec.ts` | The theme control: follows the device, survives a reload, no flash before first paint, colours change at once |
| `reduced-motion.spec.ts` | Nothing animates on load even with motion allowed; with reduced motion, no reveal, an instant toggle and no smooth scroll |
| `corners.spec.ts` | One corner-radius system (6, 10 and 14 px, round dots) on every route, with no square boxes and no pills |
| `layout.spec.ts` | No sideways scroll on any route, in both themes and with panels open; `/check` with no layout shift; the 1366 x 768 first screen; no home text under 12.5 px outside the drawing's clock axis |
| `health.spec.ts` | The home page on each day, `/method`, `/check` and `/brief` load clean; external links open in a new tab with `rel="noopener"` |
| `network-safety.spec.ts` | The browser asks only this site, fonts are served by it, no load or scroll starts a live call, `/api/health` and the pages carry no key, and the guard blocks a live-mode compare |

## Allowances still in force

The leaders test in `day-graph.spec.ts` requires every name drawn outside its bar to stand at least twice as near its
own bar as any other bar. On Glastonbury it holds out two names:

- **Abel Selaocoe & the Bantu Ensemble**, at 1440 and 1280 px wide, by design: its two-line label stands 4 px from
  its own bar and 4.03 px from the corner of Cymande's, because two of the day's lines need the room beside it.
- **The Brian Jonestown Massacre**, at 1024 x 768, an open defect: its label stands 4 px from its own bar and 7 px
  from Goat's, in both views. A separate test, "known defect D9", runs the rule at 1200 x 800 and 1024 x 768 on both
  days and accepts only that exact measurement ("The Brian Jonestown Massacre: 4.00 px from its bar, 7.00 px from
  Goat", Glastonbury at 1024 px). Any other name under the rule, or this name at any other distance, day or width,
  fails. On the phone project the same test runs at 375 x 667 and 320 x 568 with no allowance. When the label is
  fixed, the name comes out of both tests' held lists.

The line-note tests are looser on the narrowest screens. At 320 x 640 and 320 x 568 on a phone (and 1920 x 1080 on
a desktop), a note may cover at most one other set's name and two other bars, half a name per note on average. At
the other sizes they measure, a note covers no other set's name or bar.
