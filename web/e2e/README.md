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
| `home.spec.ts`, `invented-day.spec.ts` | Home on each saved day and on the invented example day; switching days |
| `hero.spec.ts`, `rail.spec.ts` | The decision card and "Open this move"; the section rail |
| `timetable.spec.ts`, `hidden-clashes.spec.ts` | The board, the key, the clash drawer; the hidden-clash examples |
| `try-a-move.spec.ts`, `keep-apart.spec.ts` | Pick a set, legal places, keep, undo; "Keep two sets apart" |
| `recorded-runs.spec.ts` | The agent section with the model off, and recorded-run replay |
| `sections.spec.ts`, `honesty.spec.ts` | What Qloo changes, who has complained, sources; the two required honesty lines |
| `check.spec.ts`, `check-price.spec.ts` | `/check`: paste, rule breaks, shared time, decisions, print; "Compare audience overlap" |
| `brief.spec.ts`, `print.spec.ts` | `/brief` and print media |
| `method.spec.ts` | `/method`: the failed pre-set test, the backtest table, the Qloo endpoints |
| `theme.spec.ts`, `intro.spec.ts` | The theme control; the opening curtain |
| `navigation.spec.ts`, `keyboard.spec.ts` | Header, footer, 404 page; keyboard paths and focus |
| `layout.spec.ts`, `health.spec.ts` | No sideways scroll; every page loads clean and well formed |
| `network-safety.spec.ts` | The browser talks to this site only and spends no Qloo or model call |

`pages/` holds page objects (locators by role and label, never `data-testid`), `helpers.ts` small shared checks,
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
