# End-to-end tests

Playwright drives a real Chromium against a running site. Two projects run every spec: `desktop` (1440 x 900)
and `phone` (390 x 844, touch).

```bash
cd web
npm run e2e                              # both projects
npx playwright test --project=phone      # one project
npx playwright test check.spec.ts        # one file
BASE_URL=http://localhost:3100 npm run e2e
npm run e2e:report                       # open the HTML report
```

`playwright.config.ts` reuses a site that is already running at `BASE_URL` (default `http://localhost:3000`) and
starts `npm run dev` only when there is none. The API behind it (`BACKEND_URL`, default `127.0.0.1:8000`) should be
the local one with no language model and with live Qloo features off; the suite never switches them on.

## What is where

| File | Journey |
| --- | --- |
| `home.spec.ts`, `invented-day.spec.ts` | Home on each saved day and on the invented example day; switching days; the home page length at 1440 px |
| `hero.spec.ts`, `rail.spec.ts` | The hero's decision group (move, readout, side effects, taste line, attribution), "Keep this move" kept in place with Add or Replace and "See your plan", the index card under the hero; the section rail |
| `day-graph.spec.ts` | The day drawn as a graph: no layout shift after the server's frame, the 390 x 844 and 375 x 667 budgets, no sideways scroll from 320 to 1440 px, the hero's word budget, the toggle's 450 ms move (none under reduced motion), the side-effect line in every state, the drawing's name per view, no hue between 15 and 75 |
| `corners.spec.ts` | One radius system: 6 px marks and labels, 10 px controls, tiles and notes, 14 px cards and panels, round dots; a page-wide sweep for square boxes, square SVG marks and pills on every route, and in print for `/brief` and `/check` |
| `timetable.spec.ts`, `hidden-clashes.spec.ts` | The board, the key, the clash drawer; the hidden-clash examples |
| `try-a-move.spec.ts`, `keep-apart.spec.ts` | Pick a set, legal places, keep, undo; "Keep two sets apart" |
| `recorded-runs.spec.ts` | "Recorded agent runs" with the model off, replay, the column beside a run, and "Keep this place" (with Add or Replace once a plan exists) into the plan and the brief |
| `sections.spec.ts`, `honesty.spec.ts` | What Qloo changes, who has complained, sources; the two required honesty lines |
| `check.spec.ts`, `check-price.spec.ts` | `/check`: paste, rule breaks, shared time, decisions, print, a published day, Find a change (same stage first, the kept-on-purpose fold); "Compare audience overlap" in saved mode, a published day's costliest clashes |
| `brief.spec.ts`, `print.spec.ts` | `/brief` and print media |
| `method.spec.ts` | `/method`: the failed pre-set test, the backtest table, the Qloo endpoints |
| `theme.spec.ts` | The theme control; a switch changes the colours at once, with no transition |
| `reduced-motion.spec.ts` | Under reduced motion: no opening or reveal, the drawing's toggle swaps at once, Keep with no press scale, no smooth scroll |
| `navigation.spec.ts`, `keyboard.spec.ts` | Header, footer, 404 page; keyboard paths and focus |
| `layout.spec.ts`, `health.spec.ts` | No sideways scroll; every page loads clean and well formed |
| `network-safety.spec.ts` | The browser talks to this site only and spends no Qloo or model call; the guard itself blocks a live-mode price |

`pages/` holds page objects (locators by role and label, plus the hero's own hooks such as `data-hero-group` and
`data-day-graph`; never `data-testid`), `helpers.ts` small shared checks,
and `fixtures.ts` the shared `test`.

## Rules every test lives under

`fixtures.ts` gives every test, with no setup:

- a **network guard**: a request to any host other than the site's own, and any request that could reach Qloo or a
  language model (`/api/runs`, `/api/pair`, `/api/price-grid` in anything but `"saved"` mode), is blocked in the
  browser and recorded; the test fails afterwards if either list is not empty;
- a **console watch**: a console error or uncaught page error fails the test. A page that is meant to 404 names the
  one error it expects: `test.use({ ignoreConsole: [/status of 404/] })`;
- `isPhone`, for the few places the page itself differs at 390 px.

Tests that read a published day (`DAYS`) skip themselves when the API serves only the invented day
(`requireSavedDays`). The invented day itself is reached by answering `/api/presets...` from `fixtures/invented-day/`,
made from the backend's own generator by `fixtures/generate-invented-day.py` (no Qloo, no model; rerun it only when
the API's shape changes).

Wait for the page, not the clock: `home.goto()` and `check.goto()` return once the page has hydrated
(`SiteChrome.waitForHydration`), because a click made earlier is lost. Do not use `waitForTimeout` or `networkidle`.

## Known defects

A test for behaviour the app gets wrong is kept and marked `test.fail()` with a comment that names the defect and how to
reproduce it. When the app is fixed the test starts to pass, Playwright reports it, and the mark comes off.

Open: D6 (round 34), the home page at 1440 px light is taller than the 6,800 px ceiling in `home.spec.ts` ("home page
length"; the measured height is attached to the test as an annotation). It is left failing, not marked, so the fix loop
sees it. Fixed and unmarked in round 31: D1 (the rail's last link), D2 (focus on the day tabs), D3 (dark-theme
print of `/` and `/method`) and D4 (the footer's "MIT licence" and "Source code" links now open in a new tab with
`rel="noopener noreferrer"`, `health.spec.ts`).

Tests never write a figure read from a saved festival day (a taste overlap, a popularity, a rank or the index)
into a spec: they read it from the page and compare, or match its shape. The invented day's figures are invented
and may be written out.
