"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ChevronDown } from "lucide-react";

import { AbstainState, ErrorState, TraceDrawer } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { AgentStatus } from "@/lib/agent-status";
import { describeReach, samplingReach } from "@/lib/clash-budget";
import {
  buildSetViews,
  clashKey,
  dayName,
  daysWithSets,
  festivalName,
  heroClash,
  involves,
  isFixedByLocks,
  partnerOf,
  topClashes,
  traceToolCalls,
  type HeroClash,
} from "@/lib/clashes";
import { pluralize } from "@/lib/format";
import { drawerRank, drawerRankOf } from "@/lib/lenses";
import type { PairClash, Preset, PresetSummary } from "@/lib/preset";
import { figureLine, type ServerSummary } from "@/lib/server-summary";
import type { PlanPreview } from "@/lib/stack";
import { cn } from "@/lib/utils";

import { AgentPanel } from "./agent-panel";
import { BudgetDial, Scorecard } from "./budget-dial";
import { ClashDrawer } from "./clash-drawer";
import { ClashList } from "./clash-list";
import { CoverageMeter } from "./coverage-meter";
import { HiddenWall } from "./hidden-wall";
import { PresetSources } from "./preset-sources";
import { RECORDED_RUNS_ID } from "./recorded-runs";
import { SummaryBoard, SummaryScore } from "./server-summary";
import { BoardSkeleton, ScoreSkeleton } from "./skeletons";
import { TasteLens } from "./taste-lens";
import { TimetableGrid } from "./timetable-grid";
import { TimetableLegend } from "./timetable-legend";
import { TimetableList } from "./timetable-list";
import { TRY_A_MOVE_ID, TryAMove } from "./try-a-move";
import { TwinCards } from "./twin-cards";
import { useAgentStatus } from "./use-agent-status";
import { useLenses } from "./use-lenses";
import { usePresets } from "./use-presets";
import { useRecordings } from "./use-recordings";

const TOP_LINKS = 10;

/** The anchor of the sources section, for the jump nav. */
const SOURCES_ID = "sources";

const HERO_LINK =
  "inline-flex items-center gap-1.5 py-1 text-sm font-semibold underline underline-offset-4 hover:text-primary";

/** The hero button says what the first click opens, and only rank 1 is called the costliest. */
const HERO_BUTTON: Record<HeroClash["kind"], string> = {
  hidden: "Open a hidden clash",
  evidence: "Open a clash and its evidence",
  costliest: "Open the costliest clash",
};

/** The hero row: the static pitch on the left, the day's score on the right. Kept short so the
 * priced timetable starts in the first screenful. */
function HeroLayout({ intro, aside, children }: { intro: ReactNode; aside: ReactNode; children?: ReactNode }) {
  return (
    <section aria-labelledby="pitch-heading" className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="bg-timegrid absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black_20%,transparent)]"
      />
      <div className="container-page pt-8 pb-8 sm:pt-10 lg:pt-10 lg:pb-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-12">
          <div className="min-w-0">
            {intro}
            {children}
          </div>
          <div className="min-w-0">{aside}</div>
        </div>
      </div>
    </section>
  );
}

/** The timetable section's frame: wider than the page container, so five stages fit. */
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
    <section aria-label={label} aria-labelledby={labelledBy} className="border-t border-border">
      <div className="mx-auto w-full max-w-[96rem] px-4 pt-7 pb-14 sm:px-6 sm:pb-16 lg:px-10">{children}</div>
    </section>
  );
}

type JumpLink = { href: string; label: string };

/**
 * In-page links under the hero. From 768 px up it sticks under the site header, and the page's
 * anchor offset grows by its height so a jump lands below it; on a phone it is one row that
 * scrolls sideways.
 */
function JumpNav({ agent, wall }: { agent: JumpLink; wall: boolean }) {
  const links: JumpLink[] = [
    { href: "#board-heading", label: "Timetable" },
    { href: `#${TRY_A_MOVE_ID}`, label: "Try a move" },
    agent,
    ...(wall ? [{ href: "#hidden-wall", label: "Hidden clashes" }] : []),
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

  return (
    <nav
      aria-label="On this page"
      className="z-30 h-11 border-y border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/85 md:sticky md:top-16 md:[html:has(&)]:scroll-pt-31"
    >
      <ul className="container-page flex h-full items-center gap-x-6 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              aria-current={current === link.href ? "location" : undefined}
              className={cn(
                "rounded-sm py-1.5 text-sm font-semibold underline-offset-4 hover:text-foreground hover:underline",
                current === link.href
                  ? "text-foreground underline decoration-2"
                  : "text-muted-foreground",
              )}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The hero's figure line, below `lg` only: there the dial sits under the pitch, past the first screen. */
function FigureLine({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="mt-4 max-w-2xl text-base leading-snug font-semibold lg:hidden">{text}</p>;
}

/**
 * The first screen before the interactive page has a festival day: the server's summary of the day
 * when there is one (the server HTML carries it), skeletons otherwise.
 */
function LoadingView({
  intro,
  summary,
  picker,
  status,
}: {
  intro: ReactNode;
  summary: ServerSummary | null;
  picker?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <>
      <HeroLayout intro={intro} aside={summary ? <SummaryScore summary={summary} /> : <ScoreSkeleton />}>
        <FigureLine text={summary?.figure ?? null} />
        {status}
      </HeroLayout>
      <BoardFrame label="Timetable">
        {picker}
        {summary ? <SummaryBoard summary={summary} /> : <BoardSkeleton />}
      </BoardFrame>
    </>
  );
}

export function ClashControlFallback({
  intro,
  summary = null,
}: {
  intro: ReactNode;
  summary?: ServerSummary | null;
}) {
  return <LoadingView intro={intro} summary={summary} />;
}

/**
 * The landing screen: loads the preset festival days, lets the visitor pick one, and shows its
 * Clash Budget Index and coverage, the priced timetable with the costliest clashes, "Try a move"
 * (every legal place for a set, priced, with no language model), the agent (live or recorded runs),
 * the hidden-clash examples and the twin card.
 */
export function ClashControl({ intro, summary = null }: { intro: ReactNode; summary?: ServerSummary | null }) {
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
        summary={summary && summary.id === loadingId ? summary : null}
        status={
          <p role="status" className="sr-only">
            Loading the festival day.
          </p>
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
      preset={preset.value}
      agentStatus={agentStatus}
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
  preset,
  agentStatus,
  picker,
}: {
  intro: ReactNode;
  preset: Preset;
  agentStatus: AgentStatus;
  picker: ReactNode;
}) {
  const days = useMemo(() => daysWithSets(preset), [preset]);
  const [day, setDay] = useState(days[0] ?? 0);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [drawer, setDrawer] = useState<DrawerState>({ clash: null, open: false, trigger: null });
  // The tested plan from "Try a move", previewed on the grid as ghosts. Never changes the dial.
  const [planPreview, setPlanPreview] = useState<PlanPreview | null>(null);

  const { festival, report } = preset;
  const name = festivalName(festival);
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
  const lenses = useLenses(preset.id, day);
  const lensRank = useMemo(() => drawerRank(lenses), [lenses]);
  const agentJump: JumpLink =
    agentStatus === "off" && recordings.runs.length > 0
      ? { href: `#${RECORDED_RUNS_ID}`, label: "Recorded runs" }
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
        aside={
          <Scorecard>
            <BudgetDial index={index} baseline={report.baseline} reach={reach} />
          </Scorecard>
        }
      >
        <FigureLine text={index === null ? null : figureLine(index)} />
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          {hero ? (
            <Button type="button" variant="ink" onClick={(event) => openClash(hero.clash, event.currentTarget)}>
              {HERO_BUTTON[hero.kind]}
            </Button>
          ) : null}
          <a href={`#${TRY_A_MOVE_ID}`} className={HERO_LINK}>
            Try a move yourself
            <ArrowDown aria-hidden="true" className="size-4" />
          </a>
          {hasWall ? (
            <a href="#hidden-wall" className={HERO_LINK}>
              See the hidden clashes
              <ArrowDown aria-hidden="true" className="size-4" />
            </a>
          ) : null}
        </div>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          {name} does not use Clash Control: this is its published {dayName(dayLabel)} timetable, scored
          independently.
        </p>
      </HeroLayout>

      <JumpNav agent={agentJump} wall={hasWall} />

      <BoardFrame labelledBy="board-heading">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-border pb-4">
          <div className="min-w-0">
            <p className="type-kicker text-muted-foreground">
              Published timetable · {preset.title}
              {festival.city ? ` · ${festival.city}` : ""}
            </p>
            <h2 id="board-heading" className="type-title mt-1.5">
              Where the clash budget goes: {festival.stages.length} stages, {views.length} sets
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {picker}
            <TraceDrawer
              toolCalls={allCalls}
              mode="recorded"
              triggerVariant="ink"
              description={`Every Qloo request behind ${preset.title}, replayed from the saved preset rather than fetched live. The API key stays on the server and is never sent to the browser.`}
              footnote={`Preset ${preset.id}${preset.built_at ? ` · built ${preset.built_at.slice(0, 10)}` : ""}`}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <CoverageMeter coverage={report.coverage} metrics={report.metrics} />
          <div className="max-md:hidden">
            <TimetableLegend planShown={planPreview !== null} />
            <p className="mt-2.5 text-xs text-muted-foreground">
              Lines join the {links.length} costliest clashes; draw on each set is its Qloo
              popularity. Hover or focus a set to see its clashes, and open any clash for the figures
              behind it.
            </p>
          </div>
        </div>

        {days.length > 1 ? (
          <SegmentedControl
            label="Day"
            size="sm"
            value={String(day)}
            onValueChange={(value) => {
              setDay(Number(value));
              setHighlight(null);
            }}
            options={days.map((index) => ({ value: String(index), label: festival.days[index] ?? `Day ${index + 1}` }))}
            className="mt-4"
          />
        ) : null}

        <div className="mt-6 grid gap-10 xl:grid-cols-[22rem_minmax(0,1fr)] xl:gap-12">
          <div className="xl:sticky xl:top-31 xl:max-h-[calc(100dvh-8.75rem)] xl:self-start xl:overflow-y-auto xl:pr-2 xl:[scrollbar-width:thin]">
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
            />
          </div>
          <div className="min-w-0">
            {/* Below 768 px: the clash list above, then the board itself in a sideways scroller
                that snaps to the stage columns, then the start-order list behind a summary. */}
            <TimetableLegend planShown={planPreview !== null} className="mb-3 md:hidden" />
            <p className="mb-3 text-xs text-muted-foreground md:hidden">Scroll sideways to see every stage.</p>
            <div className="max-md:snap-x max-md:snap-mandatory max-md:scroll-pl-[72px] max-md:overflow-x-auto max-md:overscroll-x-contain max-md:pb-3">
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
              <TimetableList className="mt-4" views={views} dayLabel={dayLabel} onOpen={openClash} />
            </details>
          </div>
        </div>
      </BoardFrame>

      {lenses ? <TasteLens lenses={lenses} ranked={ranked} onOpen={openClash} /> : null}

      <TryAMove preset={preset} day={day} ranked={ranked} isLocked={isLocked} onPlanChange={setPlanPreview} />

      <AgentPanel preset={preset} day={day} agentStatus={agentStatus} />

      <HiddenWall evidence={preset.evidence} />
      {twins.length > 0 ? (
        <TwinCards twins={twins} acts={festival.acts} />
      ) : (
        <p className="container-page py-8 text-sm text-muted-foreground">
          This day has no same-size twin pairs to show.
        </p>
      )}

      <div id={SOURCES_ID}>
        <PresetSources preset={preset} />
      </div>

      <ClashDrawer
        preset={preset}
        clash={drawer.clash}
        open={drawer.open}
        ranked={ranked}
        onSelect={(clash) => openClash(clash, null)}
        onClose={() => setDrawer((previous) => ({ ...previous, open: false }))}
        returnFocusTo={drawer.trigger}
        rankWithoutTaste={lensRank}
        rankWithoutTasteOf={drawerRankOf(lenses)}
      />
    </>
  );
}
