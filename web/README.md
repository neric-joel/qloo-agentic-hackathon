# Web

Next.js (App Router, TypeScript strict, Tailwind v4, shadcn/ui) front end for Clash Control. The landing
page is the product: a preset festival day's published timetable with every clash priced by Qloo (fans at
stake times how many of them are the same people), the Clash Budget Index, Qloo coverage, the costliest
clashes, sourced hidden-clash examples and the twin card. It sits on a shared kernel: the event-stream
client, the run state, and the components that make Qloo's part in each answer visible.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route types, then `tsc --noEmit` |
| `npm test` | Vitest (event stream, run state, presets, timetable layout, clash mapping, formatters, config) |
| `npm run check` | Lint, typecheck and tests in one go |

### Environment

Copy `.env.example` to `.env.local` if you need to change anything.

| Variable | Purpose |
| --- | --- |
| `BACKEND_URL` | Origin that `/api/*` is proxied to. Empty means `http://127.0.0.1:8000`. |
| `NEXT_PUBLIC_MOCK_STREAM` | `1` serves a synthetic festival day (invented acts, no Qloo data) and simulated event streams instead of calling the backend, and puts a "Simulated data" banner on every page. It is read at build time, so leave it unset in production. |

The browser only ever talks to this app. `next.config.ts` rewrites `/api/:path*` to
`${BACKEND_URL}/api/:path*`, so there is no CORS and the Qloo and model keys stay on the server.

Event streams pass through that rewrite, so `compress` is off in `next.config.ts` (with gzip on, the Node
server holds the whole stream back until it ends). The backend should also send
`Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` on `text/event-stream` responses, and a
`: keep-alive` comment every 15 s or so during long silences, because the client treats 60 s without any
bytes as a stalled connection.

## Layout

```
src/
  app/                 layout, theme tokens (globals.css), landing page, error and 404 pages
  components/
    kernel/            ProvenanceChip, RunSteps, TraceDrawer, RecordedBadge, AbstainState, ErrorState,
                       NeedsInput, LlmOnlyToggle, MockBadge, useAgentRun
    ui/                shadcn/ui primitives (button, sheet) and SegmentedControl
    theme/             light, dark and system theme
    site/              header, footer, logo
    clash/             the landing screen: Clash Budget dial, coverage strip, timetable grid with clash
                       links (desktop) and start-order list (mobile), ranked clash list, clash drawer,
                       hidden-clash wall, twin cards, sources, skeletons, usePresets
  lib/
    preset.ts          Preset types and a validator for /api/presets and /api/presets/{id}
    clashes.ts         set views, receipts, the Qloo requests behind a clash, display formatting
    timetable.ts       time-to-pixel scale, column frames, clash-link placement, arrow-key movement
    clash-budget.ts    dial geometry for the Clash Budget Index
    mock-preset.ts     synthetic festival day for NEXT_PUBLIC_MOCK_STREAM=1
    events.ts          AgentEvent and QlooRequestRecord types, plus a validator for incoming events
    sse.ts             streamRun(): POST + ReadableStream event-stream client
    run-state.ts       reducer that folds events into render state, plus selectors
    mock-stream.ts     simulated runs for building without the backend
    format.ts          latency, count and HTTP status formatters
    utils.ts           cn(): class merger that also knows the type-* utilities
```

## The landing screen

`GET /api/presets` lists the preset festival days (the first is shown by default; `?preset=<id>` picks
another) and `GET /api/presets/{id}` returns one with its festival, score report, the saved Qloo requests
behind it, timetable sources and evidence. Preset data is Qloo-derived and is never copied into this
folder: tests use the small hand-written fixture in `lib/fixtures/` and mock mode uses `lib/mock-preset.ts`,
both invented.

Copy rules the screen follows: every index says "by Qloo's measure"; draw is labelled as Qloo popularity
and overlap as shared audience; acts without a Qloo signal are hatched and named, never scored as zero;
hidden clashes from the press are sourced examples, not proof of detection; the festival shown does not
use the tool, and the index is not a verdict on its programming.

Accessibility: the timetable is one tab stop (arrow keys move between sets, Home and End jump within a
stage, Enter opens a set's costliest clash), each clash link has a numbered badge button, and the clash
drawer returns focus to whatever opened it. Hidden clashes differ by shape (diamond, dashed link) as well
as colour.

## The event stream

`streamRun(url, body, onEvent, signal)` POSTs JSON and delivers each `AgentEvent` (`data: <json>`, blank line)
to `onEvent`. It copes with events split across chunks, LF, CRLF and CR line endings, multi-line `data:`
fields, `:` keep-alive comments and multi-byte characters cut mid-sequence. Problems arrive as a single
`error` event instead of a rejected promise: HTTP errors, a dropped or stalled connection (60 s without
bytes), and events that are malformed or break the contract (reading stops there). Reading also stops at
`run_finished`. A server `error` is passed on and the read continues only to pick up the closing
`run_finished`. Once the outcome is known (`run_finished`, `needs_input` or `error`), a connection that drops
or goes quiet later is not reported. Aborting through `signal` stops quietly. Unknown event types are
skipped so a newer backend does not break an older client.

Conventions on top of the contract:

- **Abstain.** A `result` event with `kind: "abstain"` and `data: { reason: string, details?: string[] }`
  means Qloo has too little data. Render it with `AbstainState` (`selectAbstain()` reads it).
- **Recorded requests.** `QlooRequestRecord` has an optional `recorded: true`, set when the request was
  served from a saved fixture. The trace drawer labels those separately from live and cached ones.
- **Answering a question.** After `needs_input` the server may close the stream without `run_finished`; the
  run is then shown as waiting. `useAgentRun().answer(option)` starts a new run whose body is the previous
  body plus `answer: { question, option_id }`. Pass `buildAnswerBody` to change the shape.
- **Steps.** The backend does not have to send `step` events: `selectSteps(state)` falls back to one step per
  tool call (named after the tool), so `RunSteps` is never empty during a run.
- **Prose.** `text_delta` events from several turns of the writer are joined into `state.text`; text that
  arrives after a tool call starts a new paragraph (`\n\n`).
- **`summary` results** are only used by the simulated stream. Real screens define their own kinds.

## Using the kernel

```tsx
"use client";

import { ErrorState, RunSteps, TraceDrawer, useAgentRun } from "@/components/kernel";
import { selectSteps } from "@/lib/run-state";

export function Run() {
  const { state, start, retry } = useAgentRun({ endpoint: "/api/runs" });
  return (
    <>
      <button onClick={() => start({ preset: "demo" })}>Run</button>
      <RunSteps steps={selectSteps(state)} status={state.status} />
      <TraceDrawer toolCalls={state.toolCalls} runId={state.runId} mode={state.mode} />
      {state.error && <ErrorState message={state.error.message} retryable={state.error.retryable} onRetry={retry} />}
    </>
  );
}
```

`state` also carries `text` (streamed prose), `results`, `needsInput`, `summary` and `mode`. A stored run can
be rendered by passing its events through `reduceEvents()` from `lib/run-state`.

Rules the components follow, which new screens should keep:

- Every figure shows where it came from with a `ProvenanceChip` (`qloo`, `derived`, `llm`, `recorded`).
  Never present a model guess as Qloo data.
- Declining to answer is a result (`AbstainState`), not an error.
- Anything replayed from a script is labelled (`MockBadge`, `RecordedBadge`).
- The retry button and the `NeedsInput` options disappear when their run restarts, so move focus to a stable
  control afterwards (the landing page hands it to the run button).

## Design system

Tokens live in `src/app/globals.css` as CSS variables for light ("paper and ink") and dark ("midnight stage"),
following the system setting unless the user picks one with the header toggle. Text pairs meet WCAG AA (most
reach AAA). Status and provenance always carry an icon and a text label as well as colour.

- Fonts: Archivo (variable width, condensed for display type) and JetBrains Mono, via `next/font`.
- Type utilities: `type-display`, `type-headline`, `type-title`, `type-numeral`, `type-kicker`,
  `type-wordmark`. `type-display` sizes itself from the nearest `@container` ancestor.
- Layout: `container-page`, `bg-timegrid` (faint column grid), `ticket-perforation` (ticket-style card edge).
- Motion respects `prefers-reduced-motion`.

New shadcn components: `npx shadcn@latest add <name>`. The state variants they rely on (`data-open`,
`data-checked`, and so on) are already defined in `globals.css`.
