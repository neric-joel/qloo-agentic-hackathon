"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";

import { AbstainState, ErrorState, TraceDrawer } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { AgentStatus } from "@/lib/agent-status";
import { CHECK_LIVE } from "@/lib/check-flag";
import { describeReach, samplingReach } from "@/lib/clash-budget";
import { boardTraceDescription, popularityName, usedTitle } from "@/lib/credit";
import {
  buildSetViews,
  clashKey,
  daysWithSets,
  heroClash,
  involves,
  isFixedByLocks,
  partnerOf,
  topClashes,
  traceToolCalls,
  type HeroClash,
} from "@/lib/clashes";
import { buildDecisionCopy, type Decision } from "@/lib/decision";
import { pluralize } from "@/lib/format";
import { drawerRank, drawerRankOf } from "@/lib/lenses";
import type { PairClash, Preset, PresetSummary } from "@/lib/preset";
import type { RulePreview } from "@/lib/rule-fix";
import type { ServerSummary } from "@/lib/server-summary";
import { isRuleStackStep, sameStep, seedOutcome, type PlanPreview, type StackStep } from "@/lib/stack";
import { cn } from "@/lib/utils";

import { AgentPanel } from "./agent-panel";
import { BudgetDial, Scorecard } from "./budget-dial";
import { ClashDrawer } from "./clash-drawer";
import { ClashList, liveClashRow } from "./clash-list";
import { CoverageMeter } from "./coverage-meter";
import { DecisionCard, DecisionCardSkeleton } from "./decision-card";
import { HiddenWall } from "./hidden-wall";
import { MoreDetails } from "./more-details";
import { PresetSources } from "./preset-sources";
import { SummaryBoard, SummaryScore } from "./server-summary";
import { BoardSkeleton, ScoreSkeleton } from "./skeletons";
import { TimetableGrid } from "./timetable-grid";
import { TimetableLegend, legendSymbolCount } from "./timetable-legend";
import { TimetableList } from "./timetable-list";
import { TRY_A_MOVE_ID, TryAMove } from "./try-a-move";
import { TasteSection, WHAT_QLOO_ID, WhatQlooPointer, concurrentPairs, whatChangesTitle } from "./why-qloo";
import { WHY_THIS_MATTERS_ID, WhyThisMatters } from "./why-this-matters";
import { useAgentStatus } from "./use-agent-status";
import { useDecision } from "./use-decision";
import { useLenses } from "./use-lenses";
import { usePresets } from "./use-presets";
import { useRecordings } from "./use-recordings";

const TOP_LINKS = 10;

/** The anchor of the sources section, for the jump nav. */
const SOURCES_ID = "sources";

/** The card's footer link says what it opens, and only rank 1 is called the costliest. */
const HERO_BUTTON: Record<HeroClash["kind"], string> = {
  hidden: "Open a hidden clash",
  evidence: "Open a clash and its evidence",
  costliest: "Open the costliest clash",
};

const PROOF_LINE =
  "Run on the public timetables of Glastonbury 2025 and Riot Fest 2026. Neither festival uses Clash Control.";
export const SYNTHETIC_PROOF_LINE =
  "Shown here on an invented day: the server has no built festival day, so the acts, times and readings are made up and no Qloo request was made.";

/**
 * What a card button adds to its announcement when it takes the place of a plan that is not empty:
 * "It replaced your earlier 2 kept steps." Null when it adds to nothing or the plan already holds it.
 */
function replacedNote(plan: readonly StackStep[], seed: StackStep): string | null {
  const outcome = seedOutcome(plan, seed);
  return outcome.kind === "replace" ? `It replaced your earlier ${pluralize(outcome.dropped, "kept step")}.` : null;
}

/** Beside the paste action: what it costs the visitor, and what leaves the browser. */
export const HERO_MICROCOPY = "About a minute. Nothing leaves your browser unless you ask for prices.";

/**
 * One muted 14 px note at the foot of the pitch column: the paste's cost (when /check is live) and the
 * proof line, verbatim, joined as one paragraph of at most two lines at 1440 px. On a phone it comes last,
 * after the card and the stat sentence.
 */
function HeroNote({ className, synthetic = false }: { className?: string; synthetic?: boolean }) {
  return (
    <p className={cn("max-w-[32rem] text-sm leading-relaxed text-muted-foreground lg:max-w-none", className)}>
      {/* On a phone the paste's cost sits under the action it describes (HeroActions), so here it is
          shown from lg only. */}
      {CHECK_LIVE ? <span className="hidden lg:inline">{HERO_MICROCOPY} </span> : null}
      {synthetic ? SYNTHETIC_PROOF_LINE : PROOF_LINE}
    </p>
  );
}

/**
 * The hero's action: "Paste your own draft grid" opens /check while that page is live, as the outline
 * button (44 px, the default size, a 1.5 px ink edge with the 12 px control corner and a trailing arrow that moves 2 px), so
 * the card's "Open this move" stays the one filled ink button on the first screen in both themes.
 */
function HeroActions() {
  if (!CHECK_LIVE) return null;
  return (
    <div className="lg:mt-8">
      <Button asChild variant="outline" size="default">
        <Link href="/check">Paste your own draft grid<ArrowRight aria-hidden="true" /></Link>
      </Button>
      <p className="mt-2 max-w-[32rem] text-sm leading-relaxed text-muted-foreground lg:hidden">{HERO_MICROCOPY}</p>
    </div>
  );
}

/**
 * The hero: the static pitch and its action on the left, the decision card on the right. From `lg` the
 * card spans the column's rows and the pitch column reads from the top with no hole: pitch, the action
 * 32 px under it, the stat sentence 40 px under that and the note 16 px under the sentence, with no rule
 * between them; whatever height the card has spare falls below the note. Below `lg` the page reads in
 * source order: pitch, decision card, action, stat sentence, then the note, so a phone's first screen
 * shows the clash itself before the paste. The action is rendered twice for that, in the same grid area:
 * once before the card, shown from `lg`, and once after it, shown below `lg`. The other copy is
 * display:none at every width, so exactly one is seen, read and focused, and the tab order is the order
 * seen. The day's score sits with the timetable it reads.
 */
function HeroLayout({
  intro,
  stats,
  actions,
  aside,
  synthetic = false,
}: {
  intro: ReactNode;
  /** The complaint figures under the pitch; the page renders them, so every path shows the same line. */
  stats?: ReactNode;
  actions?: ReactNode;
  aside: ReactNode;
  synthetic?: boolean;
}) {
  return (
    <section aria-labelledby="pitch-heading">
      <div className="container-page pt-6 pb-10 sm:pt-8 lg:pt-10">
        {/* Two equal columns from 1280 px. Between 1024 and 1279 the card column is held at 35.75rem, so the
            card's running-order drawing reaches its full 24rem inside the card's padding. The pitch and the
            card's top edge start on the same line; the pitch column is top-aligned, and the last, flexible row
            under the note takes the height the card has spare. The section's 40 px foot, at every width, is the gap to the jump nav (no rule). Below 1024 px one column in source
            order, the card before the action. Every track is minmax(0, ...) and every item min-w-0, so nothing pushes the card past the
            page gutter on a phone. */}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-y-6 [grid-template-areas:'pitch'_'card'_'actions'_'stats'_'note'] sm:gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,35.75rem)] lg:grid-rows-[auto_auto_auto_auto_1fr] lg:gap-x-8 lg:gap-y-0 lg:[grid-template-areas:'pitch_card'_'actions_card'_'stats_card'_'note_card'_'._card'] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 [grid-area:pitch]">{intro}</div>
          {actions ? <div className="min-w-0 [grid-area:actions] max-lg:hidden">{actions}</div> : null}
          <div className="min-w-0 self-start [grid-area:card]">{aside}</div>
          {actions ? <div className="min-w-0 [grid-area:actions] lg:hidden">{actions}</div> : null}
          {stats ? <div className="min-w-0 [grid-area:stats] lg:mt-10">{stats}</div> : null}
          <HeroNote className="[grid-area:note] lg:mt-4" synthetic={synthetic} />
        </div>
      </div>
    </section>
  );
}

/**
 * The timetable section's frame: the page container's edges, like every other section. Five stage columns
 * get no wider than 13rem at 1280 or 1440 in either frame (the score rail takes 18rem), so the wider frame
 * returns only from 2xl (1536 px), where it buys the columns real room.
 */
function BoardFrame({
  label,
  labelledBy,
  children,
}: {
  label?: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} aria-labelledby={labelledBy}>
      {/* Open sections are parted by space, not rules: 64 px above and below (80 px from 1024 px). */}
      <div className="container-page py-16 lg:py-20 2xl:max-w-[96rem]">{children}</div>
    </section>
  );
}

type JumpLink = { href: string; label: string };

/**
 * In-page links under the hero, in the order of the sections. From 768 px up it sticks under the site header, and the page's
 * anchor offset grows by its height so a jump lands below it; on a phone it is one row that
 * scrolls sideways.
 */
function JumpNav({ agent, wall, qloo = null }: { agent: JumpLink; wall: boolean; qloo?: JumpLink | null }) {
  // In page order.
  const links: JumpLink[] = [
    ...(qloo ? [qloo] : []),
    { href: `#${WHY_THIS_MATTERS_ID}`, label: "Why this matters" },
    { href: "#board-heading", label: "Timetable" },
    ...(wall ? [{ href: "#hidden-wall", label: "Hidden clashes" }] : []),
    { href: `#${TRY_A_MOVE_ID}`, label: "Try a move" },
    agent,
    { href: `#${SOURCES_ID}`, label: "Sources" },
  ];
  const hrefs = links.map((link) => link.href).join("|");
  const [current, setCurrent] = useState<string | null>(null);

  // The section in view: the last anchor whose top is above 40% of the viewport; none at the very
  // top of the page, before the first section has reached that line.
  useEffect(() => {
    const targets = hrefs.split("|").map((href) => ({ href, id: href.slice(1) }));
    let frame = 0;
    function measure() {
      frame = 0;
      const line = window.innerHeight * 0.4;
      let active: string | null = null;
      for (const { href, id } of targets) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= line) active = href;
      }
      setCurrent(active);
    }
    function schedule() {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    }
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [hrefs]);

  // One marker under the current item, on the bar's hairline: it slides to the new item over 180 ms
  // (ease-out) and jumps at once under reduced motion. Drawn from the measured label, so it spans the
  // word at any font size; hidden when no section is current.
  const listRef = useRef<HTMLUListElement | null>(null);
  const markerRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    const marker = markerRef.current;
    if (!list || !marker) return;
    function place() {
      if (!list || !marker) return;
      const label = current ? list.querySelector<HTMLElement>(`a[href="${current}"] [data-nav-label]`) : null;
      if (!label) {
        marker.style.visibility = "hidden";
        return;
      }
      const wasHidden = marker.style.visibility !== "visible";
      // From hidden it appears in place, with no slide in from the left edge.
      if (wasHidden) marker.style.transition = "none";
      marker.style.width = `${label.offsetWidth}px`;
      marker.style.transform = `translateX(${label.offsetLeft}px)`;
      marker.style.visibility = "visible";
      if (wasHidden) {
        void marker.offsetWidth;
        marker.style.transition = "";
      }
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [current]);

  // No rule above or below the bar: the opaque paper is its only edge. From 768 px the anchor offset is 82 px:
  // with a section's 80 px top padding, a jump lands its heading about 54 px under the bar's foot (64 px
  // header plus the 44 px bar). Under 768 px the bar does not stick, so the offset is the header's 64 px less 1.
  return (
    <nav
      aria-label="On this page"
      className="z-30 h-11 bg-background max-md:[html:has(&)]:scroll-pt-[3.9375rem] md:sticky md:top-16 md:[html:has(&)]:scroll-pt-[5.125rem]"
    >
      {/* Inside the content column: plain 14 px links, each led by its step number, 44 px tall
          with 12 px sides (the first pulled back so its numeral starts on the content edge); the numerals are
          the /method rail's, 15 px in the condensed numeral face. The current
          item's 3 px ink capsule marker sits at the bar's foot. The current item is ink and semibold with an
          ink numeral (wayfinding is ink, never vermilion); no ground, no corner. */}
      <ul
        ref={listRef}
        className="container-page relative flex h-full items-center gap-x-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&>li:first-child]:-ml-3"
      >
        {links.map((link, index) => {
          const on = current === link.href;
          return (
            <li key={link.href}>
              <a
                href={link.href}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "inline-flex h-11 items-center px-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
                  on ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                <span data-nav-label="" className="inline-flex items-baseline gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn("type-numeral text-[0.9375rem] leading-none", on ? "text-foreground" : "text-muted-foreground")}
                  >
                    {index + 1}
                  </span>
                  {link.label}
                </span>
              </a>
            </li>
          );
        })}
        <li
          ref={markerRef}
          aria-hidden="true"
          style={{ visibility: "hidden" }}
          className="pointer-events-none absolute bottom-0 left-0 h-[3px] list-none rounded-bar bg-foreground motion-safe:transition-[transform,width] motion-safe:duration-[180ms] motion-safe:ease-out print:hidden"
        />
      </ul>
    </nav>
  );
}

/**
 * The first screen before the interactive page has a festival day: the server's summary of the day
 * when there is one (the server HTML carries it), skeletons otherwise.
 */
function LoadingView({
  intro,
  stats,
  summary,
  picker,
  status,
}: {
  intro: ReactNode;
  stats?: ReactNode;
  summary: ServerSummary | null;
  picker?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <>
      <HeroLayout
        intro={intro}
        stats={stats}
        synthetic={summary?.synthetic === true}
        actions={<HeroActions />}
        aside={
          <div className="space-y-4">
            {summary?.decision ? <DecisionCard copy={summary.decision} /> : null}
            {status}
          </div>
        }
      />
      <BoardFrame label="Timetable">
        {picker}
        {/* The day's score beside the clashes it adds up, where the interactive board puts its dial. */}
        <div className="grid gap-x-10 gap-y-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="min-w-0 max-w-[28rem]">{summary ? <SummaryScore summary={summary} /> : <ScoreSkeleton />}</div>
          {summary ? <SummaryBoard summary={summary} /> : null}
        </div>
        {summary ? null : <BoardSkeleton className="mt-8" />}
      </BoardFrame>
    </>
  );
}

export function ClashControlFallback({
  intro,
  stats,
  summary = null,
}: {
  intro: ReactNode;
  stats?: ReactNode;
  summary?: ServerSummary | null;
}) {
  return <LoadingView intro={intro} stats={stats} summary={summary} />;
}

/** False in the server HTML and true once the page is in the browser, with no state to set in an effect. */
function useInBrowser(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * The landing screen: loads the preset festival days, lets the visitor pick one, and shows its
 * Clash Budget Index and coverage, the priced timetable with the costliest clashes, "Try a move"
 * (every legal place for a set, priced, with no language model), the agent (live or recorded runs),
 * the hidden-clash examples and the twin card.
 */
export function ClashControl({
  intro,
  stats,
  summary = null,
}: {
  intro: ReactNode;
  stats?: ReactNode;
  summary?: ServerSummary | null;
}) {
  // The loading line is for a visitor waiting in the browser. Left out of the server HTML, it cannot
  // linger in the hidden streaming fallback and read as stale once the day has loaded.
  const inBrowser = useInBrowser();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("preset");
  const { list, preset, selectedId, retry } = usePresets(requestedId);
  // Asked once per page, alongside the presets, so the hero and the agent panel already know
  // whether the live agent is on when the festival day first renders.
  const agentStatus = useAgentStatus();

  // The native history API keeps `useSearchParams` in sync without a server round trip, so
  // switching festival days needs nothing but the preset data itself.
  function choosePreset(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", id);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  }

  if (list.status === "error" || preset.status === "error") {
    const error = list.status === "error" ? list.error : preset.status === "error" ? preset.error : null;
    return (
      <HeroLayout
        intro={intro}
        stats={stats}
        aside={
          <ErrorState
            title="Could not load the timetable"
            titleAs="h2"
            message={error?.message ?? "Something went wrong."}
            retryable={error?.retryable ?? true}
            onRetry={() => {
              retry();
              // The retry button goes away while the data reloads; keep focus on the page.
              document.getElementById("pitch-heading")?.focus();
            }}
          />
        }
      />
    );
  }

  if (list.status === "ready" && list.value.length === 0) {
    return (
      <HeroLayout
        intro={intro}
        stats={stats}
        aside={
          <AbstainState
            title="No festival days to show yet"
            reason="This server has no scored festival days. A day appears here once its published timetable has been priced against Qloo audience data."
          />
        }
      />
    );
  }

  if (preset.status !== "ready" || list.status !== "ready") {
    // The server's summary is shown only while the day it describes is the one being loaded.
    const loadingId = selectedId ?? requestedId ?? summary?.id ?? null;
    return (
      <LoadingView
        intro={intro}
        stats={stats}
        summary={summary && summary.id === loadingId ? summary : null}
        status={
          inBrowser ? (
            <p role="status" className="sr-only">
              Loading the festival day.
            </p>
          ) : null
        }
        picker={
          list.status === "ready" ? (
            <PresetPicker presets={list.value} selectedId={selectedId} onChange={choosePreset} className="mb-6" />
          ) : null
        }
      />
    );
  }

  return (
    <PresetView
      key={preset.value.id}
      intro={intro}
      stats={stats}
      preset={preset.value}
      agentStatus={agentStatus}
      serverDecision={summary && summary.id === preset.value.id ? summary.decisionData : null}
      picker={<PresetPicker presets={list.value} selectedId={selectedId} onChange={choosePreset} />}
    />
  );
}

function PresetPicker({
  presets,
  selectedId,
  onChange,
  className,
}: {
  presets: readonly PresetSummary[];
  selectedId: string | null;
  onChange: (id: string) => void;
  className?: string;
}) {
  if (presets.length < 2) return null;
  return (
    <SegmentedControl
      label="Festival day"
      size="sm"
      variant="tabs"
      value={selectedId}
      onValueChange={onChange}
      options={presets.map((item) => ({
        value: item.id,
        label: item.title,
        description: item.city ?? undefined,
      }))}
      className={className}
    />
  );
}

type Highlight = { kind: "set"; id: string } | { kind: "clash"; key: string } | null;

type DrawerState = { clash: PairClash | null; open: boolean; trigger: HTMLElement | null };

function PresetView({
  intro,
  stats,
  preset,
  agentStatus,
  serverDecision,
  picker,
}: {
  intro: ReactNode;
  stats?: ReactNode;
  preset: Preset;
  agentStatus: AgentStatus;
  /** The decision the server already holds for this preset's first day, so the card needs no request. */
  serverDecision: Decision | null;
  picker: ReactNode;
}) {
  const days = useMemo(() => daysWithSets(preset), [preset]);
  const [day, setDay] = useState(days[0] ?? 0);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [drawer, setDrawer] = useState<DrawerState>({ clash: null, open: false, trigger: null });
  // The tested plan from "Try a move", previewed on the grid as ghosts. Never changes the dial.
  const [planPreview, setPlanPreview] = useState<PlanPreview | null>(null);
  // A change from "Keep two sets apart", previewed as two ghosts. Separate from the plan above.
  const [rulePreview, setRulePreview] = useState<RulePreview | null>(null);
  // The decision card's buttons hand "Try a move" a seed (a move, or line 3's change as one step); a
  // new nonce replays it, the same one never does.
  const [seedStep, setSeedStep] = useState<{ nonce: number; step: StackStep } | null>(null);
  const [seedRule, setSeedRule] = useState<{ nonce: number; aId: string; bId: string } | null>(null);
  // The steps the plan holds now, reported by "Try a move", so the decision card can show what is already kept.
  const [keptSteps, setKeptSteps] = useState<readonly StackStep[]>([]);

  const { festival, report } = preset;
  const synthetic = preset.synthetic === true;
  const dayLabel = festival.days[day] ?? `Day ${day + 1}`;
  const views = useMemo(() => buildSetViews(preset, day), [preset, day]);
  const ranked = useMemo(() => topClashes(report.clashes, day, Number.POSITIVE_INFINITY), [report, day]);
  const links = useMemo(() => ranked.slice(0, TOP_LINKS), [ranked]);
  const slots = useMemo(() => new Map(festival.timetable.map((slot) => [slot.act_id, slot])), [festival]);
  const stages = useMemo(() => new Map(festival.stages.map((stage) => [stage.id, stage])), [festival]);
  const allCalls = useMemo(() => traceToolCalls(preset.requests, preset.id), [preset]);
  const reach = useMemo(() => describeReach(samplingReach(festival.timetable)), [festival]);
  const isLocked = useMemo(() => {
    const locked = new Set(festival.timetable.filter((slot) => slot.locked).map((slot) => slot.act_id));
    return (actId: string) => locked.has(actId);
  }, [festival]);
  const hero = useMemo(() => heroClash(ranked, preset.evidence, isLocked), [ranked, preset.evidence, isLocked]);
  // The share of the day's cost that sits between two locked sets, over every ranked clash.
  const fixedShare = useMemo(
    () => ranked.filter((clash) => isFixedByLocks(clash, isLocked)).reduce((sum, clash) => sum + clash.regret_share, 0),
    [ranked, isLocked],
  );
  const recordings = useRecordings(preset.id);
  const twins = preset.evidence?.twins ?? [];
  // The wall's hero link and jump entry only when the day has examples to show.
  const hasWall = (preset.evidence?.hidden_wall?.length ?? 0) > 0;
  const index = report.metrics.clash_budget_index;
  const decisionState = useDecision(preset.id, day, serverDecision);
  const decisionCopy = useMemo(
    () => (decisionState.status === "ready" ? buildDecisionCopy(preset, decisionState.decision) : null),
    [preset, decisionState],
  );
  // What the plan already holds of the card: its move and line 3's change, so the buttons can say so.
  const seedMove = decisionCopy?.seedMove ?? null;
  const seedChange = decisionCopy?.seedChange ?? null;
  const cardKept = useMemo(
    () => ({
      move: seedMove !== null && keptSteps.some((step) => !isRuleStackStep(step) && sameStep(step, seedMove)),
      change: seedChange !== null && keptSteps.some((step) => sameStep(step, seedChange)),
    }),
    [seedMove, seedChange, keptSteps],
  );
  const lenses = useLenses(preset.id, day);
  // A tested plan or a rule change is drawn on the board: the key must say the lines are the published timetable's.
  const planShown = planPreview !== null || rulePreview !== null;
  const sharedPairs = useMemo(() => concurrentPairs(preset, day), [preset, day]);
  // The card's clash, for its three readings; only while the card is for the day on show.
  const decisionClash =
    decisionState.status === "ready" && decisionState.decision.day === day ? decisionState.decision.clash : null;
  const lensRank = useMemo(() => drawerRank(lenses), [lenses]);
  const actName = (id: string) => festival.acts.find((act) => act.id === id)?.name ?? id;
  // Both land on the agent section's heading: the recorded runs sit level with it from 1024 px, and the list
  // itself has no top padding, so a jump to it would land its label under the sticky bar.
  const agentJump: JumpLink =
    agentStatus === "off" && recordings.runs.length > 0
      ? { href: "#agent", label: "Recorded runs" }
      : { href: "#agent", label: "Agent" };

  const { activeSetIds, activeClashKeys } = useMemo(() => {
    const setIds = new Set<string>();
    const clashKeys = new Set<string>();
    if (highlight?.kind === "set") {
      setIds.add(highlight.id);
      for (const clash of ranked) {
        if (!involves(clash, highlight.id)) continue;
        clashKeys.add(clashKey(clash));
        setIds.add(partnerOf(clash, highlight.id).act_id);
      }
    } else if (highlight?.kind === "clash") {
      clashKeys.add(highlight.key);
      const clash = ranked.find((item) => clashKey(item) === highlight.key);
      if (clash) {
        setIds.add(clash.a.act_id);
        setIds.add(clash.b.act_id);
      }
    }
    return { activeSetIds: setIds, activeClashKeys: clashKeys };
  }, [highlight, ranked]);

  function openClash(clash: PairClash, trigger: HTMLElement | null) {
    setDrawer((previous) => ({ clash, open: true, trigger: previous.open ? previous.trigger : trigger }));
  }

  return (
    <>
      <HeroLayout
        intro={intro}
        stats={stats}
        synthetic={preset.synthetic === true}
        actions={<HeroActions />}
        aside={
          <div className="space-y-4">
            {decisionCopy ? (
              <DecisionCard
                copy={decisionCopy}
                kept={cardKept}
                onOpenMove={
                  decisionCopy.seedMove
                    ? () => {
                        const move = decisionCopy.seedMove;
                        if (!move) return null;
                        const note = replacedNote(keptSteps, move);
                        setSeedStep((previous) => ({ nonce: (previous?.nonce ?? 0) + 1, step: move }));
                        return note;
                      }
                    : undefined
                }
                onTryRule={
                  decisionCopy.seedRule
                    ? () => {
                        const rule = decisionCopy.seedRule;
                        if (rule) setSeedRule((previous) => ({ nonce: (previous?.nonce ?? 0) + 1, ...rule }));
                      }
                    : undefined
                }
                onKeepChange={
                  decisionCopy.seedChange
                    ? () => {
                        const change = decisionCopy.seedChange;
                        if (!change) return null;
                        const note = replacedNote(keptSteps, change);
                        setSeedStep((previous) => ({ nonce: (previous?.nonce ?? 0) + 1, step: change }));
                        return note;
                      }
                    : undefined
                }
                onOpenHidden={hero ? (trigger) => openClash(hero.clash, trigger) : undefined}
                hiddenLabel={hero ? HERO_BUTTON[hero.kind] : undefined}
                readings={
                  decisionClash && lenses ? (
                    <WhatQlooPointer
                      lenses={lenses}
                      pairs={sharedPairs}
                      aId={decisionClash.aId}
                      bId={decisionClash.bId}
                      synthetic={synthetic}
                    />
                  ) : undefined
                }
              />
            ) : decisionState.status === "loading" ? (
              <DecisionCardSkeleton />
            ) : null}
          </div>
        }
      />

      <JumpNav
        agent={agentJump}
        wall={hasWall}
        qloo={decisionClash && lenses ? { href: `#${WHAT_QLOO_ID}`, label: whatChangesTitle(synthetic) } : null}
      />

      {/* What Qloo changes for the card's clash, the equal-popularity pairs and the two rankings of the
          day, closed by the failed test. Always rendered, so the failed test is there with no lens data. */}
      <TasteSection
        clash={
          decisionClash
            ? {
                aId: decisionClash.aId,
                bId: decisionClash.bId,
                aName: actName(decisionClash.aId),
                bName: actName(decisionClash.bId),
              }
            : null
        }
        lenses={lenses}
        pairs={sharedPairs}
        twins={twins}
        acts={festival.acts}
        ranked={ranked}
        onOpen={openClash}
        synthetic={synthetic}
      />

      {/* The problem, the pilot and what is not known, next to the failed test and before the board. */}
      <WhyThisMatters />

      <BoardFrame labelledBy="board-heading">
        {/* One header block: the dateline and heading on the left; on the right the festival tabs with
            "How Qloo was used" right under them (8 px), right-aligned from 1024 px and at the left on a
            phone. */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-4">
          <div className="min-w-0">
            <p className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
              {synthetic ? "Invented timetable" : "Published timetable"} · {preset.title}
              {festival.city ? `, ${festival.city}` : ""}
            </p>
            <h2 id="board-heading" className="type-title mt-1.5 scroll-mt-16 md:scroll-mt-26">
              Where the clash budget goes: {festival.stages.length} stages, {views.length} sets
            </h2>
          </div>
          <div className="flex min-w-0 flex-col items-start gap-2 lg:items-end">
            {picker}
            <TraceDrawer
              toolCalls={allCalls}
              mode="recorded"
              triggerVariant="ink"
              hideIcon
              triggerClassName="min-h-11 text-[0.8125rem] font-semibold lg:min-h-6"
              triggerLabel={usedTitle(preset.synthetic === true)}
              title={usedTitle(preset.synthetic === true)}
              synthetic={preset.synthetic === true}
              description={boardTraceDescription(preset.synthetic === true, preset.title)}
              footnote={`Preset ${preset.id}${preset.built_at ? ` · built ${preset.built_at.slice(0, 10)}` : ""}`}
            />
          </div>
        </div>

        {days.length > 1 ? (
          <SegmentedControl
            label="Day"
            size="sm"
            variant="tabs"
            value={String(day)}
            onValueChange={(value) => {
              setDay(Number(value));
              setHighlight(null);
            }}
            options={days.map((index) => ({ value: String(index), label: festival.days[index] ?? `Day ${index + 1}` }))}
            className="mt-4"
          />
        ) : null}

        {/* From 1280 px up the rail holds the day's score above the costliest clashes, so the stage
            headers start right under coverage and the key. Below that the rail dissolves into the column
            (display: contents) and the score comes last, after the board: under 768 px the board leads,
            then the costliest clashes; from 768 px the costliest clashes lead, then the board. The score
            holds nothing focusable, and from 768 px the list and the board keep their source order. */}
        <div className="mt-6 grid gap-10 xl:grid-cols-[18rem_minmax(0,1fr)] xl:gap-10">
          {/* From 1280 px up the whole rail is sticky (below the site header and jump bar) and scrolls on
              its own when taller than the screen, so it travels beside the grid instead of leaving blank.
              There it holds the score and the costliest clashes under one 1px rule (their own surfaces
              drop at that width). The scroll box reaches 12 px past the column on each side and pads it back,
              so its content, and the rule drawn by the one wrapper inside it, start on the section's gutter
              while the focus rings keep their room inside the clip. Below 1280 px both dissolve and each
              child keeps its own surface. */}
          <div className="min-w-0 max-xl:contents xl:sticky xl:top-31 xl:max-h-[calc(100dvh-8.75rem)] xl:self-start xl:overflow-y-auto xl:overscroll-contain xl:-mx-3 xl:scroll-py-1 xl:px-3 xl:pb-1">
            <div className="flex min-w-0 flex-col gap-10 max-xl:contents xl:gap-6 xl:border-t xl:border-border xl:pt-6">
            <Scorecard className="order-3 max-w-[28rem] xl:order-1 xl:max-w-none">
              <BudgetDial index={index} baseline={report.baseline} reach={reach} compact synthetic={synthetic} />
            </Scorecard>
            <div className="order-2 min-w-0 md:order-1 xl:order-2">
              <ClashList
                clashes={links}
                slots={slots}
                stages={stages}
                totalRanked={ranked.length}
                fixedShare={fixedShare}
                isLocked={isLocked}
                activeKeys={activeClashKeys}
                dimmed={highlight !== null}
                onOpen={openClash}
                onHighlight={(key) => setHighlight(key ? { kind: "clash", key } : null)}
                synthetic={preset.synthetic === true}
              />
            </div>
            </div>
          </div>
          <div className="order-1 min-w-0 md:order-2 xl:order-none">
            <CoverageMeter
              coverage={report.coverage}
              metrics={report.metrics}
              synthetic={synthetic}
              legend={
                <TimetableLegend
                  inline
                  planShown={planShown}
                  synthetic={synthetic}
                  className="max-md:hidden"
                  note={
                    <>
                      Lines join the {links.length} costliest clashes; draw on each set is its {popularityName(synthetic)}.
                      Open any clash for its figures.
                    </>
                  }
                />
              }
            />
            {/* Below 768 px: the key, then the board itself in a sideways scroller that snaps to the stage
                columns, then the start-order list behind a summary. Under 640 px the key folds into one
                closed summary unless a tested place is on the board, when its warning must show. */}
            {planShown ? (
              <TimetableLegend planShown synthetic={synthetic} className="mt-4 mb-3 md:hidden" />
            ) : (
              <>
                <MoreDetails
                  className="mt-4 mb-3 sm:hidden"
                  summary={`How to read the board (${pluralize(legendSymbolCount({ planShown }), "symbol")})`}
                >
                  <TimetableLegend synthetic={synthetic} className="mt-3 px-1" />
                </MoreDetails>
                <TimetableLegend synthetic={synthetic} className="mt-4 mb-3 hidden sm:flex md:hidden" />
              </>
            )}
            <p className="mb-3 text-xs text-muted-foreground md:hidden">Scroll sideways to see every stage.</p>
            <div className="max-md:snap-x max-md:snap-mandatory max-md:scroll-pl-[72px] max-md:overflow-x-auto max-md:overscroll-x-contain max-md:pb-3 md:mt-6">
              <TimetableGrid
                className="max-md:min-w-[760px]"
                views={views}
                stages={festival.stages}
                links={links}
                dayLabel={dayLabel}
                activeSetIds={activeSetIds}
                activeClashKeys={activeClashKeys}
                dimmed={highlight !== null}
                focusSetId={highlight?.kind === "set" ? highlight.id : null}
                onHighlightSet={(id) => setHighlight(id ? { kind: "set", id } : null)}
                onHighlightClash={(key) => setHighlight(key ? { kind: "clash", key } : null)}
                onOpen={openClash}
                plan={planPreview}
                rulePreview={rulePreview}
                synthetic={synthetic}
              />
            </div>
            <details className="group mt-8 md:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-border-strong bg-card px-4 py-2.5 text-sm font-semibold hover:bg-accent [&::-webkit-details-marker]:hidden">
                Show the start-order list ({pluralize(views.length, "set")})
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-150"
                />
              </summary>
              <TimetableList className="mt-4" views={views} dayLabel={dayLabel} onOpen={openClash} synthetic={synthetic} />
            </details>
          </div>
        </div>
      </BoardFrame>

      <HiddenWall evidence={preset.evidence} synthetic={synthetic} />

      <TryAMove
        preset={preset}
        day={day}
        ranked={ranked}
        isLocked={isLocked}
        onPlanChange={setPlanPreview}
        onRulePreview={setRulePreview}
        seedStep={seedStep}
        seedRule={seedRule}
        onKeptChange={setKeptSteps}
        cardMove={decisionCopy?.seedMove && decisionCopy.moveReceipt ? { move: decisionCopy.seedMove, receipt: decisionCopy.moveReceipt } : null}
      />

      <AgentPanel preset={preset} day={day} agentStatus={agentStatus} />

      <div id={SOURCES_ID}>
        <PresetSources preset={preset} />
      </div>

      <ClashDrawer
        preset={preset}
        clash={drawer.clash}
        open={drawer.open}
        ranked={ranked}
        onSelect={(clash) => openClash(clash, null)}
        onClose={() => {
          // A resize can have re-rendered the rail row that opened the drawer; return focus to its new row.
          const trigger = liveClashRow(drawer.trigger);
          setDrawer((previous) => ({ ...previous, open: false, trigger }));
        }}
        returnFocusTo={drawer.trigger}
        rankWithoutTaste={lensRank}
        rankWithoutTasteOf={drawerRankOf(lenses)}
      />
    </>
  );
}
