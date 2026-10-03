"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDown } from "lucide-react";

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
  involves,
  partnerOf,
  topClashes,
  traceToolCalls,
} from "@/lib/clashes";
import type { PairClash, Preset, PresetSummary } from "@/lib/preset";

import { AgentPanel } from "./agent-panel";
import { BudgetDial, Scorecard } from "./budget-dial";
import { ClashDrawer } from "./clash-drawer";
import { ClashList } from "./clash-list";
import { CoverageMeter } from "./coverage-meter";
import { HiddenWall } from "./hidden-wall";
import { PresetSources } from "./preset-sources";
import { BoardSkeleton, ScoreSkeleton } from "./skeletons";
import { TimetableGrid } from "./timetable-grid";
import { TimetableLegend } from "./timetable-legend";
import { TimetableList } from "./timetable-list";
import { TwinCards } from "./twin-cards";
import { useAgentStatus } from "./use-agent-status";
import { usePresets } from "./use-presets";

const TOP_LINKS = 10;

const HERO_LINK =
  "inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-4 hover:text-primary";

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

export function ClashControlFallback({ intro }: { intro: ReactNode }) {
  return (
    <>
      <HeroLayout intro={intro} aside={<ScoreSkeleton />} />
      <BoardFrame label="Timetable">
        <BoardSkeleton />
      </BoardFrame>
    </>
  );
}

/**
 * The landing screen: loads the preset festival days, lets the visitor pick one, and shows its
 * Clash Budget Index and coverage, the priced timetable with the costliest clashes, the hidden-clash
 * examples and the twin card.
 */
export function ClashControl({ intro }: { intro: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { list, preset, selectedId, retry } = usePresets(searchParams.get("preset"));
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
    return (
      <>
        <HeroLayout intro={intro} aside={<ScoreSkeleton />}>
          <p role="status" className="sr-only">
            Loading the festival day.
          </p>
        </HeroLayout>
        <BoardFrame label="Timetable">
          {list.status === "ready" ? (
            <PresetPicker presets={list.value} selectedId={selectedId} onChange={choosePreset} className="mb-6" />
          ) : null}
          <BoardSkeleton />
        </BoardFrame>
      </>
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
            <BudgetDial index={report.metrics.clash_budget_index} baseline={report.baseline} reach={reach} />
          </Scorecard>
        }
      >
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          {ranked.length > 0 ? (
            <Button type="button" variant="ink" onClick={(event) => openClash(ranked[0], event.currentTarget)}>
              Open the costliest clash
            </Button>
          ) : null}
          <a href="#hidden-wall" className={HERO_LINK}>
            See the hidden clashes
            <ArrowDown aria-hidden="true" className="size-4" />
          </a>
          {agentStatus !== "off" ? (
            <a href="#agent" className={HERO_LINK}>
              Ask the agent what happens if a set moves
              <ArrowDown aria-hidden="true" className="size-4" />
            </a>
          ) : null}
        </div>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          {name} does not use Clash Control: this is its published {dayName(dayLabel)} timetable, scored
          independently.
        </p>
      </HeroLayout>

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
            <TimetableLegend />
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
          <div className="xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:self-start xl:overflow-y-auto xl:pr-2 xl:[scrollbar-width:thin]">
            <ClashList
              clashes={links}
              slots={slots}
              stages={stages}
              totalRanked={ranked.length}
              activeKeys={activeClashKeys}
              dimmed={highlight !== null}
              onOpen={openClash}
              onHighlight={(key) => setHighlight(key ? { kind: "clash", key } : null)}
            />
          </div>
          <div className="min-w-0">
            <TimetableGrid
              className="max-md:hidden"
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
            />
            <TimetableLegend showLinks={false} className="mb-4 md:hidden" />
            <TimetableList className="md:hidden" views={views} dayLabel={dayLabel} onOpen={openClash} />
          </div>
        </div>
      </BoardFrame>

      <HiddenWall evidence={preset.evidence} />
      <TwinCards twins={preset.evidence?.twins ?? []} acts={festival.acts} />

      <AgentPanel preset={preset} day={day} agentStatus={agentStatus} />

      <PresetSources preset={preset} />

      <ClashDrawer
        preset={preset}
        clash={drawer.clash}
        open={drawer.open}
        ranked={ranked}
        onSelect={(clash) => openClash(clash, null)}
        onClose={() => setDrawer((previous) => ({ ...previous, open: false }))}
        returnFocusTo={drawer.trigger}
      />
    </>
  );
}
