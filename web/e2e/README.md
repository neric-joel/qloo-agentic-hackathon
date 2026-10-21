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
| `home.spec.ts`, `invented-day.spec.ts` | Home on each saved day and on the invented example day; the lede in the server's HTML; switching days; the home page length; the invented board's "No taste signal" and its agent section with no pointer to another day |
| `hero.spec.ts`, `rail.spec.ts` | The hero's decision group (move, readout, side effects, taste line, attribution), the dateline's "saved global Qloo reading", "Keep this move" kept in place with Add or Replace and "See your plan", the existing-plan offer that moves no hero box, the index card under the hero with its two lines beside it from 1024 px; the section rail with "Agent runs" |
| `day-graph.spec.ts` | The day drawn as a graph: no layout shift after the server's frame, the 390 x 844 and 375 x 667 budgets, no sideways scroll from 320 to 1440 px, the hero's word budget, the toggle's 450 ms move (none under reduced motion), the side-effect line in every state, the drawing's name per view, no hue between 15 and 75; its names (whole, no stub ellipsis, no line painted through a name, each name nearer its own bar, the first letter in a phone's window) and a line's note on an arrow key |
| `corners.spec.ts` | One radius system: 6 px marks and labels, 10 px controls (ruled text buttons included), tiles and notes, 14 px cards and panels, round dots; a page-wide sweep for square boxes, square SVG marks and pills on every route, and in print for `/brief` and `/check`; the drawer's corners by the screen-edge rule |
| `timetable.spec.ts`, `hidden-clashes.spec.ts` | The board, the key, the clash drawer, "scored" coverage; the hidden-clash examples, and "Hidden" in ink |
| `try-a-move.spec.ts`, `keep-apart.spec.ts` | Pick a set, legal places, keep, undo; "Listed clashes it ends / adds", the outside line in the hero's own words, the rules a place passed; "Keep two sets apart" |
| `recorded-runs.spec.ts` | "Recorded agent runs" with the model off, replay, the column beside a run, and "Keep this place" (with Add or Replace once a plan exists) into the plan and the brief; the pointer to the run that asked Qloo, "Live when recorded" on its trace, no layout shift during a replay, the control acts in the ledger |
| `sections.spec.ts`, `honesty.spec.ts` | What Qloo changes (its height, the two-set line beside the index card), who has complained (the stake line first), sources; the two required honesty lines |
| `check.spec.ts`, `check-price.spec.ts` | `/check`: paste, rule breaks, shared time, decisions, print, a published day, Find a change (same stage first, the kept-on-purpose fold); a Table-view paste into the CSV editor, a partial check that lists its skipped line, whole-grid faults that still stop it, the semicolon hint, the time line; "Compare audience overlap" in saved mode, a published day's costliest clashes, no skipped act sent |
| `brief.spec.ts`, `print.spec.ts` | `/brief` and print media, including `/check`'s draft brief after a partial check |
| `method.spec.ts` | `/method`: the failed pre-set test, the backtest table and its complained-about pairs, the Qloo endpoints, why Qloo, the four control acts |
| `theme.spec.ts` | The theme control; a switch changes the colours at once, with no transition |
| `reduced-motion.spec.ts` | Nothing animates on first paint with motion allowed (CSS animations, transitions and Web Animations, the first 3 s of a load); under reduced motion: no opening or reveal, the drawing's toggle swaps at once, Keep with no press scale, no smooth scroll |
| `navigation.spec.ts`, `keyboard.spec.ts` | Header, footer, 404 page, the section nav's "Agent runs"; keyboard paths and focus |
| `layout.spec.ts`, `health.spec.ts` | No sideways scroll, `/check` with no layout shift; every page loads clean and well formed |
| `network-safety.spec.ts` | The browser talks to this site only and spends no Qloo or model call; the other day's saved runs read at most once with a GET; the guard itself blocks a live-mode price |

Round 36 added, each in the file named:

| File | What it pins |
| --- | --- |
| `day-graph.spec.ts` | The leaders: every name drawn outside its bar has one 1 px leader, at most 24 px, from its name's box to its own bar's rounded edge, in both views at 1440, 1280 and 390, with no name dropped and no leader without a name |
| `timetable.spec.ts`, `try-a-move.spec.ts`, `invented-day.spec.ts` | Whose lock it is: the board's key says "Locked by this app: the last set on its stage stays in place." on both published days and "Locked: an invented fixed slot." on the invented day; the costliest clashes' locked share and Try a move say "sets this app locks"; coverage counts sets; the drawer's "The score" |
| `honesty.spec.ts` | The price words: on `/`, Riot Fest, `/method`, `/check` and the kept brief, every disclosure open, the only "price" words are the ones round 36 kept by name (the footer's sources line, and on `/method` the "full price" family and "the printed price"); no page says "not by the festival" |
| `check.spec.ts`, `print.spec.ts` | `/check`: the header words, one column of time ranges and the dotted, compact and "h" time forms read line by line; a header it cannot read refused in one message that names the missing column and quotes the cells it did not read; a skip that names the act and quotes the value; the rail's split counts; a published day's lock clause; the printed draft's heading and sign-off; nothing sent while pasting |
| `method.spec.ts` | The live rows that no longer name the agent's tools, no "only" on `/search`, the explore-tools sentence, the control acts' percentile sentence, the lock rule in the limits, the follow-up's finding visible with no click, and every anchor |
| `brief.spec.ts` | The day's figure under the title with its caption, the lock line exactly where a shown row is marked both locked, "not scored", and one page at Letter and A4 bare and kept on both days |
| `recorded-runs.spec.ts`, `navigation.spec.ts` | After a replay ends, the section heading clear of the sticky bars by 8 px from 1024 px (on one column the run's question is, with the heading scrolled wholly past), the run picker's label clear of them at the page's end, and the "Agent runs" jump landing clear of them |

`pages/` holds page objects (locators by role and label, plus the hero's own hooks such as `data-hero-group` and
`data-day-graph`; never `data-testid`), `helpers.ts` small shared checks,
and `fixtures.ts` the shared `test`.

## Rules every test lives under

`fixtures.ts` gives every test, with no setup:

- a **network guard**: a request to any host other than the site's own, and any request that could reach Qloo or a
  language model (`/api/runs`, `/api/pair`, `/api/price-grid` in anything but `"saved"` mode), is blocked in the
  browser and recorded; the test fails afterwards if either list is not empty. A request to the site's API with a
  method other than GET fails the test too unless it is the engine's what-if (`POST /api/presets/{id}/whatif`, sent by
  Keep, Add or Replace) or a saved-mode compare (`POST /api/price-grid`, answered from a saved day with no Qloo
  request). No spec presses a live re-check or a live-mode compare;
- a **console watch**: a console error or uncaught page error fails the test. A page that is meant to 404 names the
  one error it expects: `test.use({ ignoreConsole: [/status of 404/] })`;
- `isPhone`, for the few places the page itself differs at 390 px.

Tests that read a published day (`DAYS`) skip themselves when the API serves only the invented day
(`requireSavedDays`). The invented day itself is reached by answering `/api/presets...` from `fixtures/invented-day/`,
made from the backend's own generator by `fixtures/generate-invented-day.py` (no Qloo, no model; rerun it only when
the API's shape changes). The lede above the hero is drawn by the server from its own reading of the API, which the
browser-side fixture cannot reach, so the invented lede is pinned in unit tests (`synthetic-trust.test.ts`).

Wait for the page, not the clock: `home.goto()` and `check.goto()` return once the page has hydrated
(`SiteChrome.waitForHydration`), because a click made earlier is lost. Do not use `waitForTimeout` or `networkidle`.

## Budgets the suite holds (round 35, unchanged in round 36)

| Budget | Where |
| --- | --- |
| Home page at most 6,800 px tall at 1440 x 900 light and 11,800 px at 390 x 844 dark, every disclosure closed | `home.spec.ts` |
| Hero at most 125 visible words at 1440 and 122 at 390 on the published default (drawing names not counted) | `day-graph.spec.ts` |
| Keep this move ends by y = 787 at 390 x 844, its confirmation by 844; at 375 x 667 the side effects end by 667 and Keep by 760 | `day-graph.spec.ts`, `hero.spec.ts` |
| With the offer open (a step already kept), every hero box within 1 px of the plain kept state at 1440 x 900, 390 x 844 and 375 x 667, the whole offer in view | `hero.spec.ts` |
| Drawing names at 1440 x 900: at most 3 not whole on Glastonbury and 8 on Riot Fest, none without a name; at 1280 x 800 at most 5 and 12; no ellipsis with under 8 characters before it; 0 painted-stroke samples in a name, tag or plate at 1440, 1280, 1024 and 390 | `day-graph.spec.ts` |
| "What Qloo changes" at most 760 px at 1440 light and 1,500 px at 390 dark | `sections.spec.ts` |
| Layout shift: under 0.0005 for the hero over 5 s (from round 36 on a load with the webfont already cached, so a dev server that serves the font late does not count as the page's shift); 0.000 for `/check` over 5 s; at most 0.01 after a replay starts | `day-graph.spec.ts`, `layout.spec.ts`, `recorded-runs.spec.ts` |
| First paint with motion allowed: 0 CSS animation starts, 0 transition starts, 0 `Element.animate` calls in the first 3 s, nothing running after | `reduced-motion.spec.ts` |

## Known defects

A test for behaviour the app gets wrong is kept and marked `test.fail()` with a comment that names the defect and how to
reproduce it. When the app is fixed the test starts to pass, Playwright reports it, and the mark comes off.

None is open. D6 (round 34), the home page at 1440 px light over its 6,800 px ceiling, is fixed: the round-35 home
measures under it, and "home page length" in `home.spec.ts` holds the ceiling with no mark and no allowance. Fixed and
unmarked in round 31: D1 (the rail's last link), D2 (focus on the day tabs), D3 (dark-theme print of `/` and
`/method`) and D4 (the footer's "MIT licence" and "Source code" links now open in a new tab with
`rel="noopener noreferrer"`, `health.spec.ts`).

Tests never write a figure read from a saved festival day (a taste overlap, a popularity, a rank or the index)
into a spec: they read it from the page and compare, or match its shape. The invented day's figures are invented
and may be written out.
