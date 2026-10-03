# Clash Control

Clash Control helps a festival programmer decide which set-time clash is worth moving. It checks a timetable against hard rules (changeovers, curfew, locked sets, pairs that must never overlap), ranks the clashes by time shared, draw and a taste-overlap rank calculated from Qloo audience data, and tests a move against every rule before it prices it.

**Live demo:** [clash-control.vercel.app](https://clash-control.vercel.app) · [How we know](https://clash-control.vercel.app/method)

Taste overlap is a rank from 0 to 100 among the acts on one day's bill. It is not the share of fans two acts have in common, an attendance estimate or a money figure. The Clash Budget Index compares a day's taste-overlap cost with random valid reorderings of the same lineup (100 is their average; lower is lower cost). It is a reading of one measure, not a verdict on a real festival's programming.

## What the app does

- **One decision on the first screen.** For a published day, the costliest clash that has a legal place lowering the index: the move, the sets' shared minutes before and after, and the index before and after. A second line gives the smallest change this search found that would end the overlap if a rule said the two sets must never share time.
- **Try a move.** Pick a set; the engine lists every legal start on a 5-minute grid and prices each one. Keep a move to stack the next test on top of it.
- **Keep two sets apart.** Pick two sets that share time. The search covers single places for either set and swaps with one other set, each checked for a new rule break. A kept rule change becomes one tested step of the plan.
- **One-page brief.** `/brief` prints the day's figures and the kept plan.
- **Check a grid (`/check`).** Paste one day of a draft timetable and list its rule breaks and the sets that share time. It runs in the browser: nothing pasted is sent anywhere, and it shows no Qloo-derived value for pasted acts.
- **How we know (`/method`).** The backtest against press-flagged clashes, including the pre-set test that failed and the exploratory follow-up run afterwards.
- **Live pair check.** For one displayed pair, the server asks Qloo again and shows the fresh reading beside the saved one. It needs a Qloo key and `PAIR_CHECK_ENABLED`; it is on in the public deployment and stops calling Qloo when the month's remaining allowance falls below `QLOO_QUOTA_FLOOR`.
- **Agent.** An optional agent explains a clash, tests a move or records a rule through the same engine. It needs a language-model provider, which is off by default and off in the public deployment outside test windows. Recorded runs replay without a model call, with their captured status shown.

The backend computes everything on the page. Qloo returns popularity and audience affinities; it does not return the taste-overlap rank, the clash price or the index.

## Qloo usage

The code calls three Qloo endpoints and no others. The API key stays on the backend.

| Endpoint | Used for |
| --- | --- |
| `GET /search` | Match each act name to a Qloo artist entity and read its popularity. Unmatched acts stay unpriced. |
| `GET /v2/insights` | Rank the other acts on a bill for one act's audience (the affinity readings behind taste overlap). |
| `GET /v2/analysis/compare` | Read the taste tags two audiences share (clash receipts, `explain_clash`, the live pair check). |

| Where it happens | Requests |
| --- | --- |
| Building the Glastonbury 2025 Sunday preset | 104 (45 `/search`, 36 `/v2/insights`, 23 `/v2/analysis/compare`) |
| Building the Riot Fest 2026 Sunday preset | 70 (39 `/search`, 31 `/v2/insights`) |
| One live pair check | 3 (two `/v2/insights`, one `/v2/analysis/compare`), private, never retried |
| One `explain_clash` agent tool call | 1 (`/v2/analysis/compare`), only when both acts have a Qloo id |
| Everything else (decision, moves, rule search, plans, brief, `/check`, recorded runs) | 0 |

The preset counts are the lengths of each preset's saved `requests` list, which holds one record per request the build sent. An agent run is capped at 12 Qloo requests (`AGENT_MAX_QLOO_CALLS_PER_RUN`). A generic explore scenario for the agent (`ALLOW_EXPLORE`, off by default) calls `/search` and `/v2/insights` once per lookup within that cap. Qloo's month allowance is shared across all of this, so the live pair check and the agent's Qloo-backed tools stop calling Qloo below the quota floor.

## Run it locally

Prerequisites: Python 3.12 or newer with [uv](https://docs.astral.sh/uv/), and Node.js with npm. You do not need a Qloo key, an `.env` file or any presets.

```bash
# terminal 1: the API
cd backend
uv sync --dev
uv run --with uvicorn uvicorn app.main:app --reload --port 8000

# terminal 2: the web app
cd web
npm ci
npm run dev
```

Open `http://localhost:3000`. The web app proxies `/api/*` to `http://127.0.0.1:8000` (set `BACKEND_URL` to change it).

**Presets are optional.** A preset is one festival day scored ahead of time. Real presets hold Qloo-derived data, so `backend/presets/` is git-ignored and never committed. When that folder is missing or holds no preset, the API serves one invented day instead, `Lanternfield Friday (synthetic demo)`, flagged `synthetic: true`. The page shows the banner `Synthetic example day: invented acts, no Qloo data`. Its acts, set times, popularity and affinities are generated from a set random seed (`app/schedule/synthetic.py`); no Qloo request is made and nothing on it says anything about a real festival. Every route works on it, including the decision, moves, rule search and plans. The names are random word pairs and could match a real act by chance. To read the day as JSON: `uv run python scripts/make_synthetic_preset.py --out synthetic.json` from `backend/`.

To build a real preset you need a Qloo key in `backend/.env` (copy `backend/.env.example`; the file is git-ignored):

```bash
cd backend
uv run python scripts/build_preset.py glastonbury-2025 Sun --stages main --cache ~/qloo-cache --out presets/glastonbury-2025-sun.json
```

The published timetables the builder reads are in `backend/app/lineups/data/`. Responses are saved to `--cache` first, so rebuilding spends no quota; keep that folder outside the repository. Do not commit presets, cached responses or keys.

For a frontend-only preview with a simulated event stream and no backend, run the web app with `NEXT_PUBLIC_MOCK_STREAM=1`. The page labels that mode as simulated.

### Checks

```bash
cd backend && uv run pytest -q && uv run ruff check . && uv run ruff format --check .
cd web && npm run lint && npm run typecheck && npm test
node --test scripts/*.test.mjs        # from the repository root
```

The backend tests use fakes and `httpx.MockTransport`; none calls Qloo or a model.

## How it fits together

- `backend/app/schedule/`: the timetable engine. Layout and rule checks, scoring, the Clash Budget Index baseline (random valid timetables), the move search and the rule search.
- `backend/app/qloo/`: the Qloo client (cache, retries, request records, an allowance guard) and the construction of taste overlap from affinity rankings.
- `backend/app/presets.py`, `decision.py`, `whatif.py`, `audit.py`, `pair.py`, `recordings.py`: the read-only API over saved days, plus `POST /api/pair` and `POST /api/presets/{id}/whatif`. The full overlap matrix stays on the server.
- `backend/app/agent/`, `runs.py`: the optional agent and its tools, which call the same engine.
- `web/`: a Next.js 16 app (App Router, Tailwind v4). Pages: `/`, `/method`, `/brief`, `/check`. `next.config.ts` rewrites `/api/*` to the backend; `src/proxy.ts` signs the caller's address for the API's per-visitor caps.

See [web/README.md](web/README.md) for the frontend.

## Limits

- **The pre-set test failed.** Taste overlap put 46.8% of 42 press-flagged clash clusters (68 scored pairs) in the top quarter of their day, against a bar of 60% written down before the test. Its AUC was 0.634, against 0.512 for genre tags and 0.722 for Qloo popularity. A later label-shuffle check is exploratory: it ran after the test failed, on a press-skewed set, and treats pairs as independent although they come from 42 complaints. The move-suggestion check missed its bar too (7.1 index points against 10). The full figures and method are on [How we know](https://clash-control.vercel.app/method).
- **Taste overlap is a rank, not attendance.** It says how alike Qloo ranks two audiences in taste relative to one bill. Acts Qloo has no signal for are left out, never scored as zero; across the five festivals tested, 449 of 624 acts had a usable signal.
- **Moves are graded by the measure that found them.** A lower index after a move is expected under that measure and says nothing about a better real timetable. The rule search covers single-set places on a 5-minute grid and two-set changes; longer chains are not searched. Real programmers weigh many constraints this app does not see.
- **The festivals shown do not use Clash Control.** The two published days are scored from public timetables. Nothing on them is a festival's own data or view.
- **Saved Qloo-derived data is not in this repository.** Presets, saved responses and recorded runs are built outside version control.

## License

[MIT](LICENSE).
