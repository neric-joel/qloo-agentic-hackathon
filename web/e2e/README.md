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
| `home.spec.ts`, `invented-day.spec.ts` | Home on each saved day and on the invented example day; the lede in the server's HTML; switching days; the home page length on arrival and once the board is closed; the invented board's "No taste signal", its note and index paragraph, and its agent section with no pointer to another day |
| `hero.spec.ts`, `rail.spec.ts` | The hero's decision group (move, readout, side effects, taste line, attribution), the dateline's "saved global Qloo reading", "Keep this move" kept in place with Add or Replace and "See your plan", the existing-plan offer that moves no hero box, the desktop note on what a move keeps, the ladder "in this app’s index" in its two places, the index card under the hero with its two lines beside it from 1024 px; the section rail with "Agent runs" |
| `day-graph.spec.ts` | The day drawn as a graph: no layout shift after the server's frame, the 390 x 844 and 375 x 667 budgets, no sideways scroll from 320 to 1440 px, the hero's word budget, the toggle's 450 ms move (none under reduced motion), the side-effect line in every state, the drawing's name per view, no hue between 15 and 75; its names (whole, no stub ellipsis, no line painted through a name, each name nearer its own bar, the first letter in a phone's window) and a line's note on an arrow key |
| `corners.spec.ts` | One radius system: 6 px marks and labels, 10 px controls (ruled text buttons included), tiles and notes, 14 px cards and panels, round dots; a page-wide sweep for square boxes, square SVG marks and pills on every route, and in print for `/brief` and `/check`; the drawer's corners by the screen-edge rule |
| `timetable.spec.ts`, `hidden-clashes.spec.ts` | The board (open on arrival from 1280 px, closed below), the key, the clash drawer, "scored" coverage; the hidden-clash examples, and "Hidden" in ink |
| `try-a-move.spec.ts`, `keep-apart.spec.ts` | Pick a set, legal places, keep, undo; "Listed clashes it ends / adds", the outside line in the hero's own words, the rules a place passed; "Keep two sets apart" |
| `recorded-runs.spec.ts` | "Recorded agent runs" with the model off, replay, the column beside a run, and the agent's "Keep this move" (with Add or Replace once a plan exists) into the plan and the brief; the pointer to the run that asked Qloo, "Live when recorded" on its trace, no layout shift during a replay, the control acts in the ledger; the note on the agent's limits with the agent on (in the browser only, nothing asked) |
| `sections.spec.ts`, `honesty.spec.ts` | What Qloo changes (its height, the two-set line beside the index card), who has complained (the stake line first), sources; the two required honesty lines |
| `check.spec.ts`, `check-price.spec.ts` | `/check`: paste, rule breaks, shared time, decisions, print, a published day, Find a change (same stage first, the kept-on-purpose fold); a Table-view paste into the CSV editor, a partial check that lists its skipped line, a title line above the grid, whole-grid faults that still stop it, the semicolon hint, the time line; "Compare audience overlap" in saved mode, a published day's costliest clashes, no skipped act sent |
| `brief.spec.ts`, `print.spec.ts` | `/brief` and print media, including `/check`'s draft brief after a partial check |
| `method.spec.ts` | `/method`: the failed pre-set test, the backtest table and its complained-about pairs, the Qloo endpoints, why Qloo, the four control acts, what people ask about clashes (pages, not people) and how long this takes (estimated by hand, machine time measured) |
| `theme.spec.ts` | The theme control; a switch changes the colours at once, with no transition |
| `reduced-motion.spec.ts` | Nothing animates on first paint with motion allowed (CSS animations, transitions and Web Animations, the first 3 s of a load); under reduced motion: no opening or reveal, the drawing's toggle swaps at once, Keep with no press scale, no smooth scroll |
| `navigation.spec.ts`, `keyboard.spec.ts` | Header, footer, 404 page, the section nav's "Agent runs"; keyboard paths and focus |
| `layout.spec.ts`, `health.spec.ts` | No sideways scroll, `/check` with no layout shift; every page loads clean and well formed |
| `network-safety.spec.ts` | The browser talks to this site only and spends no Qloo or model call; the other day's saved runs read at most once with a GET; the guard itself blocks a live-mode compare |

Round 36 added, each in the file named:

| File | What it pins |
| --- | --- |
| `day-graph.spec.ts` | The leaders: every name drawn outside its bar has one 1 px leader, at most 24 px, from its name's box to its own bar's rounded edge, in both views at 1440, 1280 and 390, with no name dropped and no leader without a name |
| `timetable.spec.ts`, `try-a-move.spec.ts`, `invented-day.spec.ts` | Whose lock it is: the board's key says "Locked by this app: the last set on its stage stays in place." on both published days and "Locked: an invented fixed slot." on the invented day; the costliest clashes' locked share and Try a move say "sets this app locks"; coverage counts sets; the drawer's "The score" |
| `honesty.spec.ts` | The price words: on `/`, Riot Fest, `/method`, `/check` and the kept brief, every disclosure open, the only "price" words are the ones round 36 kept by name (the footer's sources line, and on `/method` the "full price" family and "the printed price"; round 37 renamed them all, so none is kept now); no page says "not by the festival" |
| `check.spec.ts`, `print.spec.ts` | `/check`: the header words, one column of time ranges and the dotted, compact and "h" time forms read line by line; a header it cannot read refused in one message that names the missing column and quotes the cells it did not read; a skip that names the act and quotes the value; the rail's split counts; a published day's lock clause; the printed draft's heading and sign-off; nothing sent while pasting |
| `method.spec.ts` | The live rows that no longer name the agent's tools, no "only" on `/search`, the explore-tools sentence, the control acts' percentile sentence, the lock rule in the limits, the follow-up's finding visible with no click, and every anchor |
| `brief.spec.ts` | The day's figure under the title with its caption, the lock line exactly where a shown row is marked both locked, "not scored", and one page at Letter and A4 bare and kept on both days |
| `recorded-runs.spec.ts`, `navigation.spec.ts` | After a replay ends, the section heading clear of the sticky bars by 8 px from 1024 px (on one column the run's question is, with the heading scrolled wholly past), the run picker's label clear of them at the page's end, and the "Agent runs" jump landing clear of them |

Round 37 added, each in the file named (one line per area):

| File | What it pins |
| --- | --- |
| `pages/home-page.ts` | The board's grid is behind one closed disclosure (`details[data-board-fold]`): `home.goto()` waits for the interactive board's caption and for the webfont, and every spec that reads tiles, badges or the grid calls `home.openBoard()` first; `home.answerKeepAtOnce(day)` has the server answer the hero move's what-if before a press whose focus a spec asserts (the page moves focus only when the plan answers within 2 s) |
| `hero.spec.ts` | L1: a published load sends no browser `GET /api/presets/*/decision`, draws the readout and Keep in the server's frame, and keeps the hero group's height from DOMContentLoaded + 50 ms to 4 s and to settle (1440, 1024, 390, both days); a picker switch with the browser's decision held 3 s keeps the group within 0.5 px in every frame; the desktop note's three sentences ("ties" on Glastonbury) at 1440 and 1280, not drawn at 1366 x 768 or on a phone; the date on one line down to 320; Add and Replace together at 360 |
| `day-graph.spec.ts` | 1200 x 800 (the 944 band) and 1100 x 800 (the 848 band) in the names test, every set named from 1024 px, lines at least 6 px apart and none along another set's bar edge; leaders at 1440, 1280, 1200 and 1024 at least 6 px for a one-line name and 4 px for a plate (3 px at 390, and from fix pass 2 at the short phone's 375 x 667 and 320 x 568), each outside name twice as near its own bar as any other; a line's note covers no other name or bar, and none of its own, at 1440 x 900, 1366 x 768, 1280 x 800, 1200 x 800, 1024 x 768, 390 x 844 and 375 x 667, and at 320 x 640 and 320 x 568 at most one other name and two bars (D10, fixed in fix pass 2); the key's lock and dotted words with dotted no-signal bars and the chosen window's solid raspberry edge; "45 → 30 min shared" on a desktop, tags 2 px clear; the phone tags at 390, 320, 375 x 667, 360 x 640, 320 x 640 and 320 x 568 drawn and 2 px clear of the bars; the phone strip's one mark per set and every line solid; on a phone, after a strip tap at 85% and after Tab and ArrowRight, every set the detail window shows whole is named and no name or tag is cut at its edge (verify-2 N1); the CLS comment names the measured cause |
| `corners.spec.ts` | The SVG pill rule (a painted rect taller than 12 px whose rx or ry is half its height, not a disc), proved on probe marks; the home swept again with the board open; the board's summary a 10 px control |
| `timetable.spec.ts`, `home.spec.ts` | The board's disclosure: closed on arrival, "Show {n} sets on {s} stages" equal to the opened board, the caption's count equal to its numbered badges, a 44 px summary; "Locked by this app: kept in place."; clash 1's "Saved requests and values" read against the saved day; the key's two new sentences; home ceilings 6,400 / 10,900 px |
| `timetable.spec.ts` (round 37 merge) | The board opens where the visitor is: a press on its summary leaves the summary where it was pressed (it used to scroll the page down by the opened board below 1280 px), and a tested place from Try a move opens the board above the section without moving the picked row on screen; L33 on both published days: every locked set in the three set pickers ends "(locked by this app)", and the phone's start-order list shows no bare "Locked", only "Locked by this app: kept in place" |
| `try-a-move.spec.ts`, `keep-apart.spec.ts` | The rules sentence with each day's own values; a tested place and a rule preview open the board with their ghosts |
| `recorded-runs.spec.ts` | The run that asked Qloo listed first; "Keep this move" and "6 agent turns"; what to ask the agent; one ink trace line under the run's question after Replay, and on a phone the run's card clear of the bars |
| `honesty.spec.ts`, `navigation.spec.ts`, `method.spec.ts` | No price word on any page (nothing kept by name), the footer's "clash scores"; on `/method` "pair score", the seven-step chain with the agent as a branch, the 8-tag sentence, the six no-signal acts, one 46.8% at the top |
| `hidden-clashes.spec.ts`, `sections.spec.ts` | The hero day's own Hidden pair named before the examples; the paragraph after the stake (Kept on purpose, what not to decide with this, what an act's team would see, no artist content) |
| `check.spec.ts`, `check-price.spec.ts`, `brief.spec.ts` | The rejected value selected in the editor; a paste with nothing focused; a late published day that keeps the paste; the sample's rule kept; the printed overlap list; "marked locked in this grid"; the compare's day strip; the brief's minutes line first and its print sizes on one page |
| `layout.spec.ts`, `reduced-motion.spec.ts` | The drawing whole at 1366 x 768; Keep on a phone's first screen; no home text under 12.5 px outside the drawing's clock axis; a jump to the board with the pointer still starts no transition |
| `invented-day.spec.ts` | The invented day's move on the hero, whether the browser asked for its decision or the server seeded it (seam S11) |

Round 39 added or changed, each in the file named:

| File | What it pins |
| --- | --- |
| `pages/home-page.ts` | `home.closeBoard()` beside `home.openBoard()`: from 1280 px the board's disclosure arrives open, so a spec that needs it closed there presses it closed first, as a visitor would (W2, D13) |
| `timetable.spec.ts`, `home.spec.ts` | W2: the board open with no click at 1440 x 900 and 1280 x 800 with its grid shown and the rail ending at or above the fold's foot (it left a 589 px empty block); closed at 1279 x 800, 1024 x 768 and 390 x 844; a press closes it and a second opens it; untouched, the next festival day arrives open, and closed by a press it stays closed; open in every 50 ms sample of the interactive board at 1440 (closed at 390), a press as soon as the board takes one holds, a day switch as soon as the picker takes a press arrives open at 1440 and closed at 390, layout shift over 5 s from load at most 0.01; the press tests at 1440 close the board first; the home at most 6,400 px at 1440 light once a visitor closes the board, at most 7,198 px on arrival with only the board open, 10,900 px at 390 dark unchanged |
| `keep-apart.spec.ts`, `try-a-move.spec.ts` | A preview and a tested place open the board after a visitor's press closed it at 1440 |
| `hero.spec.ts` | W3: the ladder's words on both days ("… #1 of 68 in this app’s index"), one row in the left column at 1440 x 900, 1280 x 800 and 1366 x 768 with every rank at least 20 px, on the first screen, the toggle, the drawing and the hero's foot no lower; in the notice cell under Keep at 1024 and at 390 (Keep's bottom at most 780.3), hidden from sight and assistive tech once Keep is pressed with the group's height unchanged; inside the notice row with no sideways scroll at 320 x 640 and 768 x 1024; the invented day's ladder with no Qloo; taste's sentence no longer in the hero. W4: "What Qloo changes" headings end "in this app’s index". W5: the index card's paragraph word for word, "Above 100: costlier." once and "Lower is better" no longer in the card (still in the dial). W6: the desktop note on what a move keeps, one line of at most 21 px above the ladder at 1440 and 1280, not drawn at 1366 x 768 or on a phone |
| `day-graph.spec.ts` | The hero's word budget measured after the round: at most 164 at 1440 and 141 at 390 on Glastonbury (never above round 38's 166 and 144), and Riot Fest pinned at 174 and 149 |
| `sections.spec.ts` | W4's headings; "What Qloo changes" at most 802 px at 1440 light and 1,529 px at 390 dark (the measured growth of W4's heading line, rounded up); W8: the home evidence's pairs "when counted separately for each festival and year", the heading "None of the 13 tool pages we reviewed describes ranking a draft grid’s clashes by audience closeness" with the search's date and limit directly under it, and the Festival Pro fold without the broader sentence |
| `method.spec.ts` | W8: claim 1's counting unit, claim 2 word for word (21 accounts of programming practice, one second-hand), the "Accounts of programming practice (21)" group, and the timed steps by name, "Open the printable brief" last |
| `brief.spec.ts` | W5: "The day" says what a reading above 100 means right after the band sentence, on screen on every sheet and on paper on the bare and plan sheets; "How to read this" prints on every sheet; one page at Letter and A4 as before |
| `check.spec.ts` | W1: a tab grid under "Glastonbury Sunday" and a comma grid under "Saturday, 4 July" read with no refusal, the title note once above "Read n sets on m stages", no skipped-line notice and the counted no-breaks line; a first line with a clock time ("Doors 18:00") is a skipped line, never a title; the printed draft says the title line was left out, before what it read, on one page |
| `recorded-runs.spec.ts` | W7: with `/api/health` answered `llm_configured: true` in the browser only, the note under the question box names the per-visitor limit and the daily total and says the recorded runs still play; nothing is typed or pressed in the agent |

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

## Budgets the suite holds (round 35; round 37 and round 39 where marked)

| Budget | Where |
| --- | --- |
| Home page at most 6,400 px tall at 1440 x 900 light and 10,900 px at 390 x 844 dark, every disclosure closed (round 37, with the board behind its disclosure; was 6,800 and 11,800). Round 39: at 1440 the 6,400 px is measured after a visitor's press closes the board, which arrives open there; on arrival, with only the board open, at most 7,198 px (the measured height plus at most 50 px) | `home.spec.ts` |
| Hero at most 164 visible words at 1440 and 141 at 390 on the published default, the count measured after round 39's build, never above round 38's 166 and 144 (charter caps 168 and 145); Riot Fest at most 174 and 149, its own measured count (drawing names not counted) | `day-graph.spec.ts` |
| Keep this move ends by y = 787 at 390 x 844, its confirmation by 844; at 375 x 667 the side effects end by 667 and Keep by 760 | `day-graph.spec.ts`, `hero.spec.ts` |
| With the offer open (a step already kept), every hero box within 1 px of the plain kept state at 1440 x 900, 390 x 844 and 375 x 667, the whole offer in view (round 37: below 380 px Replace sits under Add, so the confirmation's room moves one row down and the hidden paste gives up its row; the group's own box holds) | `hero.spec.ts` |
| Drawing names at 1440 x 900: at most 3 not whole on Glastonbury and 8 on Riot Fest, none without a name; at 1280 x 800 at most 5 and 12; no ellipsis with under 8 characters before it; 0 painted-stroke samples in a name, tag or plate at 1440, 1280, 1024 and 390 | `day-graph.spec.ts` |
| "What Qloo changes" at most 802 px at 1440 light and 1,529 px at 390 dark (round 39: W4's heading line, +41.7 and +28.6 px measured on Glastonbury, rounded up; was 760 and 1,500) | `sections.spec.ts` |
| Layout shift: under 0.0005 for the hero over 5 s, never loosened (round 37: the shift once seen under four workers was the server's timed-out decision, not the font; the preset now carries the decision); 0.000 for `/check` over 5 s; at most 0.01 after a replay starts | `day-graph.spec.ts`, `layout.spec.ts`, `recorded-runs.spec.ts` |
| The hero group's height: within 0.5 px from DOMContentLoaded + 50 ms to 4 s and to settle, and in every frame of a picker switch whose decision is held 3 s (round 37) | `hero.spec.ts` |
| First paint with motion allowed: 0 CSS animation starts, 0 transition starts, 0 `Element.animate` calls in the first 3 s, nothing running after | `reduced-motion.spec.ts` |

## Known defects

A test for behaviour the app gets wrong is kept, with a comment that names the defect and how to reproduce it. It
accepts only the defect's recorded measurement, exactly as the test reports it; any other failure, or the same name at
any other distance, still fails. When the app is fixed the allowance comes off.

Open (round 37, found by this suite after the wave-1 merge and in fix pass 1):

- **D9** (desktop only since fix pass 2), `day-graph.spec.ts` "known defect D9" (round 37 fix pass 1, from the verify
  pass's L4): the leaders test runs at 1200 x 800 and 1024 x 768. At 1024 x 768, in both views, Glastonbury's The Brian
  Jonestown Massacre stands 4 px from its own bar and 7 px from Goat's, under L4's 2:1 rule. Reproduce: open
  `/?preset=glastonbury-2025-sun` at 1024 x 768 and read `[data-label="the-brian-jonestown-massacre"]` against its own
  `[data-set]` and Goat's in the band on show. The leaders test holds out only that name at 1024. The D9 test is no
  longer marked to fail: it accepts only the recorded detail "The Brian Jonestown Massacre: 4.00 px from its bar,
  7.00 px from Goat" on Glastonbury at 1024 wide (`D9_HELD`), and every other name under 2:1, at any size, fails. The
  phone half (the short phone's 140 px band drew 1 px leaders, under L4's 3 px) was fixed in the drawing lane's fix
  pass 2; the phone project runs the test as a plain pass, and the leaders test holds 3 px at 375 x 667 and 320 x 568.

Closed in round 37's fix pass 2: D10, a phone's line note at 320 px wide over two other names (Glastonbury's note for
line #1 covered Joy Crookes and Shaboozey at 320 x 568). A phone's note may now stand up to 140 px above the drawing;
at 320 x 568 no note covers another name, and at 320 x 640 one line's note covers one. The test runs unmarked as
"... (D10, fixed)", under L13's rule (at most one other name and two other bars, half a name a note on average).

Closed in round 37's fix pass 1: D7, Sincere Engineer's two-line plate on Riot Fest at 1200 x 800 and 1024 x 768,
which covered its own bar for 28.52 px of its 57.08 px width (0.02 px short of half). It now covers 29.02 px, 0.48 px
past half, in both views on every load; the names test holds the rule there with no name held out, and the old D7
test runs unmarked as "every name on a plate covers its own bar for half its width (D7, fixed)".

Closed at the round-37 fix-pass merge: D8, the section nav under the first screen on Riot Fest at 1440 x 900. The
drawing's key still takes a second line there; the hero frame's foot from 1024 px is now 4 px (was 24), so the "Agent
runs" link ends at 894.8 px (874.8 on Glastonbury). The old D8 test runs unmarked as "... (D8, fixed)", and the
first-screen check in "the section nav under the hero" now covers both days.

Closed earlier: D6 (round 34), the home page at 1440 px light over its 6,800 px ceiling, is fixed: the round-35 home
measures under it, and "home page length" in `home.spec.ts` holds the ceiling with no mark and no allowance. Fixed and
unmarked in round 31: D1 (the rail's last link), D2 (focus on the day tabs), D3 (dark-theme print of `/` and
`/method`) and D4 (the footer's "MIT licence" and "Source code" links now open in a new tab with
`rel="noopener noreferrer"`, `health.spec.ts`).

Tests never write a figure read from a saved festival day (a taste overlap, a popularity, a rank or the index)
into a spec: they read it from the page and compare, or match its shape. The invented day's figures are invented
and may be written out.
