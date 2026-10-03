"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { dayName } from "@/lib/clashes";
import { movableSets, type PickableSet } from "@/lib/moves";
import type { Preset } from "@/lib/preset";
import {
  BOTH_LOCKED,
  INDEX_NOTE,
  NO_RESULT,
  SMALLEST_FIRST,
  fixGhosts,
  fixIndexLine,
  fixSummary,
  lockedNote,
  moveLine,
  previewAnnouncement,
  requestRuleFixes,
  type RuleAnswer,
  stageFitNote,
  type RuleFix,
  type RuleFixes,
  type RulePreview,
} from "@/lib/rule-fix";
import { overlapWindow } from "@/lib/timetable";
import { pluralize } from "@/lib/format";

/** Where the section sits, for links and the seed's scroll. */
export const KEEP_APART_ID = "keep-apart";

/** A search, a refusal or a failure for one pair; `idle` before the first Search. */
type Search =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; fixes: RuleFixes }
  | { status: "refused"; key: string; message: string }
  | { status: "error"; key: string };

/** Answers already in, by preset and unordered pair, so asking again for a pair costs no request. */
const answers = new Map<string, RuleFixes>();

function pairKey(presetId: string, a: string, b: string): string {
  return `${presetId}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;
}

type Group = { id: string; label: string; sets: PickableSet[] };

function groupByStage(sets: readonly PickableSet[]): Group[] {
  const groups: Group[] = [];
  for (const set of sets) {
    const last = groups.at(-1);
    if (last && last.id === set.stageId) last.sets.push(set);
    else groups.push({ id: set.stageId, label: set.stageName, sets: [set] });
  }
  return groups;
}

function SetOptions({ groups }: { groups: readonly Group[] }) {
  return groups.map((group) => (
    <optgroup key={group.id} label={group.label}>
      {group.sets.map((set) => (
        <option key={set.actId} value={set.actId}>
          {set.start} {set.name}
          {set.locked ? " (locked)" : ""}
        </option>
      ))}
    </optgroup>
  ));
}

function ChangeCard({
  fix,
  n,
  before,
  dayLabel,
  pressed,
  onPreview,
}: {
  fix: RuleFix;
  n: number;
  before: number | null;
  dayLabel: (day: number) => string | null;
  pressed: boolean;
  onPreview: () => void;
}) {
  const index = fixIndexLine(fix, before);
  const flags = stageFitNote(fix);
  return (
    <li className="rounded-lg border border-border bg-background p-3.5 sm:p-4">
      <p className="type-kicker text-muted-foreground">Change {n}</p>
      <ul className="mt-1.5 space-y-0.5 font-semibold">
        {fix.moves.map((move) => (
          <li key={move.actId} className="break-words">
            {moveLine(move, dayLabel(move.day))}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">
        {fixSummary(fix)}
        {index ? ` · ${index}` : ""}
        {flags ? ` · ${flags}` : ""}
      </p>
      <p className="mt-0.5 text-sm">Adds no rule break; ends this overlap.</p>
      <Button type="button" variant={pressed ? "ink" : "outline"} className="mt-3" aria-pressed={pressed} onClick={onPreview}>
        Preview on the timetable
      </Button>
    </li>
  );
}

/**
 * "Keep two sets apart": the visitor picks two sets that share time and the route searches every
 * place for either set and every swap of one with another set, keeping only changes after which the
 * two share no minute and the day has no new rule break. A change can be previewed on the timetable
 * as two ghost slots; that preview is separate from the kept plan and never enters the brief. The
 * index shown is the route's, for information: it does not order the list.
 */
export function KeepApart({
  preset,
  day,
  seed,
  onPreview,
}: {
  preset: Preset;
  day: number;
  /** A pair the decision card asks for; a new `nonce` runs the search again, the same one does not. */
  seed?: { nonce: number; aId: string; bId: string } | null;
  onPreview?: (preview: RulePreview | null) => void;
}) {
  const firstId = useId();
  const secondId = useId();
  const resultHeadingId = useId();
  const sectionRef = useRef<HTMLElement | null>(null);
  const resultRef = useRef<HTMLHeadingElement | null>(null);
  const wantsFocus = useRef(false);
  const { festival } = preset;

  const sets = useMemo(() => movableSets(preset, day), [preset, day]);
  const byId = useMemo(() => new Map(sets.map((set) => [set.actId, set])), [sets]);
  const slots = useMemo(() => new Map(festival.timetable.map((slot) => [slot.act_id, slot])), [festival]);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  // The pair last searched for, and the answer that came back for it.
  const [wanted, setWanted] = useState<{ a: string; b: string; attempt: number } | null>(null);
  const [outcome, setOutcome] = useState<{ key: string; attempt: number; answer: RuleAnswer } | null>(null);
  // The change being previewed, tied to the pair it belongs to.
  const [previewing, setPreviewing] = useState<{ key: string; index: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [handledSeed, setHandledSeed] = useState(0);
  const multiDay = festival.days.length > 1;
  const dayLabel = useCallback(
    (index: number) => (multiDay ? dayName(festival.days[index] ?? `Day ${index + 1}`) : null),
    [festival, multiDay],
  );
  const before = preset.report.metrics.clash_budget_index;

  const wantedKey = wanted ? pairKey(preset.id, wanted.a, wanted.b) : null;
  const known = wantedKey ? answers.get(wantedKey) : undefined;
  const search: Search = !wanted || !wantedKey
    ? { status: "idle" }
    : known
      ? { status: "ready", key: wantedKey, fixes: known }
      : outcome && outcome.key === wantedKey && outcome.attempt === wanted.attempt
        ? outcome.answer.status === "ready"
          ? { status: "ready", key: wantedKey, fixes: outcome.answer.fixes }
          : outcome.answer.status === "refused"
            ? { status: "refused", key: wantedKey, message: outcome.answer.message }
            : { status: "error", key: wantedKey }
        : { status: "loading", key: wantedKey };

  const groups = useMemo(() => groupByStage(sets), [sets]);
  // The second select lists the sets that share time with the first before every other set.
  const partnerGroups = useMemo(() => {
    const mine = slots.get(first);
    if (!mine) return { partners: [] as Group[], others: groupByStage(sets) };
    const concurrent = sets.filter((set) => {
      const slot = slots.get(set.actId);
      return set.actId !== first && slot && slot.day === mine.day && overlapWindow(mine, slot) !== null;
    });
    const ids = new Set(concurrent.map((set) => set.actId));
    return {
      partners: groupByStage(concurrent),
      others: groupByStage(sets.filter((set) => set.actId !== first && !ids.has(set.actId))),
    };
  }, [sets, slots, first]);

  // The preview leaves with the section and whenever the pair searched for changes.
  const previewOut = useRef(onPreview);
  useEffect(() => {
    previewOut.current = onPreview;
  }, [onPreview]);
  useEffect(() => {
    previewOut.current?.(null);
  }, [wantedKey]);
  useEffect(() => () => previewOut.current?.(null), []);

  // Asks the route for the pair unless the page already holds the answer.
  const attempt = wanted?.attempt ?? 0;
  const wantedA = wanted?.a;
  const wantedB = wanted?.b;
  useEffect(() => {
    if (!wantedA || !wantedB || !wantedKey || answers.has(wantedKey)) return;
    let active = true;
    requestRuleFixes(preset.id, wantedA, wantedB).then((answer) => {
      if (answer.status === "ready") answers.set(wantedKey, answer.fixes);
      if (active) setOutcome({ key: wantedKey, attempt, answer });
    });
    return () => {
      active = false;
    };
  }, [preset.id, wantedA, wantedB, wantedKey, attempt]);

  function run(aId: string, bId: string) {
    if (aId === bId || !byId.has(aId) || !byId.has(bId)) return;
    wantsFocus.current = true;
    setPreviewing(null);
    setAnnouncement("");
    setWanted((current) => ({ a: aId, b: bId, attempt: (current?.attempt ?? 0) + 1 }));
  }

  // A seed from the decision card: choose both sets and search, as state adjusted while rendering. A
  // new nonce runs it again, the same one does not. The section scrolls into view once.
  const seedNonce = seed?.nonce ?? 0;
  const seedA = seed?.aId;
  const seedB = seed?.bId;
  if (seedA && seedB && seedNonce !== 0 && seedNonce !== handledSeed && byId.has(seedA) && byId.has(seedB) && seedA !== seedB) {
    setHandledSeed(seedNonce);
    setFirst(seedA);
    setSecond(seedB);
    setPreviewing(null);
    setAnnouncement("");
    setWanted((current) => ({ a: seedA, b: seedB, attempt: (current?.attempt ?? 0) + 1 }));
  }
  useEffect(() => {
    if (seedNonce === 0) return;
    wantsFocus.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sectionRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [seedNonce]);

  // Focus lands on the result heading once it is on the page.
  const settled = search.status !== "idle" && search.status !== "loading";
  useEffect(() => {
    if (!settled || !wantsFocus.current) return;
    wantsFocus.current = false;
    resultRef.current?.focus({ preventScroll: true });
  }, [settled, wantedKey, attempt]);

  function changePick(setter: (id: string) => void, id: string) {
    setter(id);
    setWanted(null);
    setPreviewing(null);
    setAnnouncement("");
  }

  function previewFix(fix: RuleFix, index: number, fixes: RuleFixes) {
    const ghosts = fixGhosts(fix);
    if (ghosts.length === 0 || !wantedKey) return;
    setPreviewing({ key: wantedKey, index });
    onPreview?.({ ghosts, pair: { aId: fixes.a.actId, bId: fixes.b.actId } });
    setAnnouncement(previewAnnouncement(fix));
  }

  function clearPreview() {
    setPreviewing(null);
    onPreview?.(null);
    setAnnouncement("Preview cleared.");
  }

  const activePreview = previewing && previewing.key === wantedKey ? previewing.index : null;

  const canSearch = first !== "" && second !== "" && first !== second && search.status !== "loading";
  const result = search.status === "ready" ? search.fixes : null;
  const note = result ? lockedNote(result) : null;

  return (
    <section
      id={KEEP_APART_ID}
      ref={sectionRef}
      aria-labelledby="keep-apart-heading"
      className="mt-10 rounded-xl border border-border-strong bg-card p-4 sm:p-6"
    >
      <h3 id="keep-apart-heading" className="type-title">
        Keep two sets apart
      </h3>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed">
        Pick two sets that share time. The search checks every place for either set and every swap of two sets
        that keeps all rules.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <label htmlFor={firstId} className="block text-sm font-semibold">
            First set
          </label>
          <select
            id={firstId}
            value={first}
            onChange={(event) => changePick(setFirst, event.target.value)}
            className="mt-1.5 h-11 w-full min-w-0 rounded-md border border-border-strong bg-card px-3 text-[0.9375rem] text-foreground"
          >
            <option value="" disabled>
              Choose a set
            </option>
            <SetOptions groups={groups} />
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={secondId} className="block text-sm font-semibold">
            Second set
          </label>
          <select
            id={secondId}
            value={second}
            onChange={(event) => changePick(setSecond, event.target.value)}
            className="mt-1.5 h-11 w-full min-w-0 rounded-md border border-border-strong bg-card px-3 text-[0.9375rem] text-foreground"
          >
            <option value="" disabled>
              Choose a set
            </option>
            {partnerGroups.partners.length > 0 ? (
              <optgroup label={`Share time with ${byId.get(first)?.name ?? "the first set"}`}>
                {partnerGroups.partners.flatMap((group) =>
                  group.sets.map((set) => (
                    <option key={set.actId} value={set.actId}>
                      {set.start} {set.name} · {group.label}
                      {set.locked ? " (locked)" : ""}
                    </option>
                  )),
                )}
              </optgroup>
            ) : null}
            <SetOptions groups={partnerGroups.others} />
          </select>
        </div>
        <Button
          type="button"
          variant="ink"
          disabled={!canSearch}
          className="w-full lg:w-auto"
          onClick={() => run(first, second)}
        >
          Search
        </Button>
      </div>

      <div className="mt-5" aria-busy={search.status === "loading"}>
        {search.status === "loading" ? (
          <div className="flex min-h-20 items-center gap-2 rounded-lg border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            Searching every place and swap for {byId.get(first)?.name ?? "the first set"} and{" "}
            {byId.get(second)?.name ?? "the second set"}
          </div>
        ) : search.status === "error" ? (
          <div role="alert" className="rounded-lg border border-destructive/50 bg-danger-bg p-4">
            <p className="text-[0.9375rem] font-semibold">Could not run this search.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => run(first, second)}>
              <RotateCcw aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : search.status === "refused" ? (
          <p role="alert" className="rounded-lg border border-border-strong p-4 text-[0.9375rem] font-semibold">
            {search.message}
          </p>
        ) : result ? (
          <div>
            <h4
              id={resultHeadingId}
              ref={resultRef}
              tabIndex={-1}
              className="type-kicker text-muted-foreground outline-none"
            >
              Keeping {result.a.act} and {result.b.act} apart
            </h4>
            {result.holds ? (
              <p className="mt-2 text-[0.9375rem] font-semibold">
                {result.a.act} and {result.b.act} do not share any time on this timetable, so the rule already holds.
              </p>
            ) : result.a.locked && result.b.locked ? (
              <p className="mt-2 text-[0.9375rem] font-semibold">{BOTH_LOCKED}</p>
            ) : (
              <>
                {note ? <p className="mt-2 text-[0.9375rem] font-semibold">{note}</p> : null}
                {result.fixes.length === 0 ? (
                  <p className="mt-2 text-[0.9375rem] font-semibold">{NO_RESULT}</p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {SMALLEST_FIRST}{" "}
                      {result.singleSetPlaces === 0
                        ? "This search found no single-set place that ends it."
                        : `${pluralize(result.singleSetPlaces, "single-set place")} end${result.singleSetPlaces === 1 ? "s" : ""} it.`}
                      {result.fixesFound > result.fixes.length
                        ? ` Showing ${result.fixes.length} of ${result.fixesFound} changes found.`
                        : ""}
                    </p>
                    <ol aria-label="Changes that end the overlap" className="mt-3 grid gap-3 lg:grid-cols-3">
                      {result.fixes.map((fix, i) => (
                        <ChangeCard
                          key={fix.moves.map((move) => `${move.actId}@${move.start}`).join("+")}
                          fix={fix}
                          n={i + 1}
                          before={before}
                          dayLabel={dayLabel}
                          pressed={activePreview === i}
                          onPreview={() => previewFix(fix, i, result)}
                        />
                      ))}
                    </ol>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Button type="button" variant="outline" disabled={activePreview === null} onClick={clearPreview}>
                        Clear preview
                      </Button>
                      <p className="min-w-0 flex-1 basis-64 text-xs leading-relaxed text-muted-foreground">
                        {INDEX_NOTE}
                      </p>
                    </div>
                    {activePreview !== null ? (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        This is a tested timetable, not a kept move. The links and rank badges on the timetable still
                        describe the published day.
                      </p>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement ||
          (result && !result.holds
            ? result.fixes.length > 0
              ? `${pluralize(result.fixesFound, "change")} found for ${result.a.act} and ${result.b.act}.`
              : NO_RESULT
            : "")}
      </p>
    </section>
  );
}
