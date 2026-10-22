"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

import { ProvenanceChip, TraceDrawer } from "@/components/kernel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  BROAD_TAGS_NOTE,
  clashKey,
  formatDraw,
  formatOverlap,
  formatPercent,
  formatShare,
  hiddenReason,
  hostOf,
  isFixedByLocks,
  isWebUrl,
  LABEL_META,
  leadingTags,
  receiptFor,
  requestsForActs,
  tagLabel,
  traceToolCalls,
  withoutTasteLine,
} from "@/lib/clashes";
import {
  popularityName,
  formulaNoteShort,
  noRequestsLine,
  signalSentence,
  tagsSource,
  tagsTitle,
  tasteSource,
  traceDescription,
  usedTitle,
} from "@/lib/credit";
import { formatInteger, pluralize } from "@/lib/format";
import { pairCheckKey, type PairCheck } from "@/lib/pair-check";
import type { Act, PairClash, Preset, Receipt, SetSlot, Stage } from "@/lib/preset";
import {
  CHAIN_INVENTED,
  CHAIN_TITLE,
  candidatesAsked,
  compareLine,
  MATCHED_LABEL,
  matchedNames,
  overlapLine,
  requestChain,
  requestNoun,
  retainedLine,
  savedLine,
  shortId,
  tagsLine,
  type ChainAct,
} from "@/lib/request-chain";
import { formatRange, overlapWindow } from "@/lib/timetable";


import { bothLockedLabel } from "./clash-list";
import { LiveRecheck } from "./live-recheck";
import { LabelBadge, Meter } from "./marks";

type ClashDrawerProps = {
  preset: Preset;
  /** The clash to show. It stays set while the drawer animates closed. */
  clash: PairClash | null;
  open: boolean;
  /** Ranked clashes of the day, for previous and next. */
  ranked: readonly PairClash[];
  onSelect: (clash: PairClash) => void;
  onClose: () => void;
  /** Gets focus back when the drawer closes. */
  returnFocusTo: HTMLElement | null;
  /**
   * Where a pair would rank on draw and time alone, from the lens endpoint, when it has loaded: a
   * rank (1 = costliest), null when the pair is unpriced or costs nothing in that view (the timetable
   * is the same, so a priced clash never stops being concurrent), undefined when there is no reading
   * for it. Contract F types it `number | null`; undefined is accepted too. Without the prop the drawer
   * prints no such line.
   */
  rankWithoutTaste?: (aId: string, bId: string) => number | null | undefined;
  /** How many pairs are ranked on draw and time alone (the "of N" after that rank), when the server says. */
  rankWithoutTasteOf?: number;
};

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-8", className)}>
      <h3 className="pb-2 text-[0.8125rem] leading-5 font-semibold">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Figure({
  label,
  value,
  unit,
  note,
  chip,
}: {
  label: string;
  value: string;
  unit?: string;
  note: ReactNode;
  chip: ReactNode;
}) {
  return (
    <div className="min-w-0 border-t border-border pt-3">
      <dt className="flex items-center justify-between gap-2">
        <span className="text-[0.8125rem] leading-5 font-semibold text-muted-foreground">{label}</span>
        {chip}
      </dt>
      <dd className="mt-2">
        <span className="type-numeral text-4xl leading-none tabular-nums">{value}</span>
        {unit ? <span className="ml-1 font-mono text-xs text-muted-foreground">{unit}</span> : null}
        <span className="mt-1.5 block text-xs leading-snug text-muted-foreground">{note}</span>
      </dd>
    </div>
  );
}

function ActPanel({
  act,
  slot,
  stage,
  synthetic,
}: {
  act: Act | undefined;
  slot: SetSlot | undefined;
  stage: Stage | undefined;
  synthetic: boolean;
}) {
  if (!act) return null;
  return (
    <div className="min-w-0 rounded-md border border-border bg-card p-4">
      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        {stage?.name ?? "Unknown stage"}
        {slot ? ` · ${formatRange(slot)}` : ""}
      </p>
      <p className="type-title mt-1.5 break-words">{act.name}</p>
      <p className="mt-1 text-sm text-muted-foreground">{act.genre ?? "No genre tag"}</p>
      {act.popularity !== null ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              Draw <span className="text-muted-foreground">({popularityName(synthetic)})</span>{" "}
              <span className="font-mono font-semibold tabular-nums">{formatDraw(act.popularity)}</span>
              <span className="text-muted-foreground"> / 100</span>
            </span>
            <ProvenanceChip provenance="recorded" size="sm" synthetic={synthetic} />
          </div>
          <Meter value={act.popularity} label={`Draw ${formatDraw(act.popularity)} of 100`} className="mt-2" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The tags Qloo returned for this pair, in the order they are stored (Qloo's score, highest first),
 * the first few and a count of the rest.
 */
function PairTags({
  receipt,
  hasEvidence,
  a,
  b,
  synthetic,
}: {
  receipt: Receipt | null;
  hasEvidence: boolean;
  a: PairClash["a"];
  b: PairClash["b"];
  synthetic: boolean;
}) {
  if (!hasEvidence) {
    return <p className="text-sm text-muted-foreground">No audience comparison was run for this festival day.</p>;
  }
  if (!receipt) {
    return <p className="text-sm text-muted-foreground">No audience comparison was run for this pair.</p>;
  }
  if (receipt.shared_tags.length === 0) {
    // Only genre, subgenre and theme tags are saved, so an empty list does not mean none came back.
    return (
      <>
        <p className="text-sm text-muted-foreground">
          No genre or theme tags are saved for this pair, so its score rests on the taste-overlap
          ranking alone.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Main genre tags: {a.genre ?? "none"} and {b.genre ?? "none"}.
        </p>
      </>
    );
  }
  const { shown, more } = leadingTags(receipt.shared_tags);
  return (
    <>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((tag) => (
          <li
            key={tag.name}
            className={cn("tag max-w-full whitespace-normal", synthetic ? "text-foreground" : "text-prov-qloo")}
          >
            {tagLabel(tag.name)}
          </li>
        ))}
        {more > 0 ? <li className="px-1 py-1 text-xs text-muted-foreground">+{more} more</li> : null}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">{BROAD_TAGS_NOTE}</p>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ProvenanceChip provenance="recorded" size="sm" synthetic={synthetic} />
        {tagsSource(synthetic)}
      </p>
    </>
  );
}

/**
 * One act's line of "Saved requests and values": its saved /search, the entity this app used (the first 8 characters,
 * the full id in a title attribute), its saved popularity and how many /v2/insights requests rank from it. A clause
 * the saved data does not hold (no saved search, no entity, no popularity) is left out. Qloo's endpoints in teal.
 */
function ChainActLine({ act }: { act: ChainAct }) {
  const clauses: ReactNode[] = [];
  if (act.search) {
    clauses.push(
      <span key="search">
        <code className="font-mono text-[0.8125rem] text-prov-qloo">/search</code> &ldquo;{act.search.query}&rdquo;
        {act.search.take !== null ? ` ${candidatesAsked(act.search.take)}` : null}
      </span>,
    );
  }
  if (act.entityId) {
    clauses.push(
      <span key="entity">
        entity this app used{" "}
        <code title={act.entityId} className="font-mono text-[0.8125rem]">
          {shortId(act.entityId)}
        </code>
      </span>,
    );
  }
  if (act.popularity !== null) {
    clauses.push(
      <span key="popularity">
        popularity <span className="font-mono tabular-nums">{act.popularity}</span>
      </span>,
    );
  }
  if (act.entityId) {
    // insightsCount's words, with the endpoint set in mono teal.
    clauses.push(
      <span key="insights">
        its ranked row: {formatInteger(act.insights)}{" "}
        <code className="font-mono text-[0.8125rem] text-prov-qloo">/v2/insights</code> {requestNoun(act.insights)}
      </span>,
    );
  }
  return (
    <li data-chain-act className="min-w-0 break-words">
      <span className="font-semibold">{act.name}:</span>{" "}
      {clauses.map((clause, i) => (
        <Fragment key={i}>
          {i > 0 ? " · " : null}
          {clause}
        </Fragment>
      ))}
    </li>
  );
}

/**
 * "Saved requests and values" (round 37, L85): the walk from the saved requests to the score for this pair, read
 * from the preset the page holds (`requestChain`); nothing is fetched. Per act its line (ChainActLine); then the
 * taste overlap on to the pair score and the index; what the ledger holds for the pair's comparison; Qloo's search
 * match for each act from the saved reading (or, on a preset that holds none, that the names were not retained);
 * where the receipt holds no shared tag, why or that none is stored; and the saved date.
 * On the invented day, one line: no request was made.
 */
function SavedRequests({ preset, shown }: { preset: Preset; shown: PairClash }) {
  const chain = preset.synthetic ? null : requestChain(preset, shown.a.act_id, shown.b.act_id);
  const matched = chain ? matchedNames(chain.acts) : null;
  const tags = chain ? tagsLine(chain) : null;
  return (
    <Section title={CHAIN_TITLE}>
      <div data-request-chain className="text-sm leading-relaxed">
        {chain === null ? (
          <p className="text-muted-foreground">{CHAIN_INVENTED}</p>
        ) : (
          <>
            <ul className="space-y-2">
              {chain.acts.map((act) => (
                <ChainActLine key={act.id} act={act} />
              ))}
            </ul>
            <p className="mt-3">{overlapLine(formatOverlap(chain.overlap ?? shown.audience_overlap))}</p>
            <p className="mt-2">
              {chain.compares > 0 ? (
                // compareLine's words, with the endpoint set in mono teal.
                <>
                  {formatInteger(chain.compares)} saved{" "}
                  <code className="font-mono text-[0.8125rem] text-prov-qloo">/v2/analysis/compare</code>{" "}
                  {requestNoun(chain.compares)}.
                </>
              ) : (
                compareLine(0)
              )}
            </p>
            {matched ? (
              <p data-matched-names className="mt-2 text-muted-foreground">
                {MATCHED_LABEL} {matched}
              </p>
            ) : (
              <p className="mt-2 text-muted-foreground">{retainedLine(chain.sharedTags)}</p>
            )}
            {matched && tags ? <p className="mt-2 text-muted-foreground">{tags}</p> : null}
            {chain.savedOn ? <p className="mt-2 text-muted-foreground">{savedLine(chain.savedOn)}</p> : null}
          </>
        )}
      </div>
    </Section>
  );
}

/**
 * Under the opening sentence of a clash whose two sets are both locked. A published day's locks are this
 * app's, so it says so and that no move is suggested, in the costliest-clashes line's words; the invented
 * day's fixed slots cannot move.
 */
export function bothLockedNote(synthetic: boolean): string {
  return synthetic
    ? "Both sets are locked, so this clash cannot be moved. It still counts in the day’s cost."
    : "This app locks both sets, so it suggests no move for this clash. It still counts in the day’s cost.";
}

/** What the details need, and nothing about the sheet around them. */
type ClashDetailsProps = {
  preset: Preset;
  shown: PairClash;
  rankWithoutTaste?: ClashDrawerProps["rankWithoutTaste"];
  rankWithoutTasteOf?: number;
  /** An earlier live check of this pair, kept by the drawer. */
  earlier?: PairCheck | null;
  onResult?: (key: string, check: PairCheck) => void;
  /** The element that holds the opening sentence: the sheet's description in the drawer, a paragraph elsewhere. */
  Description?: ElementType;
};

/**
 * The body of the drawer for one clash: the opening sentence, both acts, the live re-check, the price and
 * its formula, the saved requests and values behind it (round 37), the label and confidence, the pair's tags and where the figures came from. Exported apart
 * from the sheet so it can be rendered on its own; on an invented day (`preset.synthetic`) every line that
 * would credit Qloo says the figure is invented instead.
 */
export function ClashDetails({
  preset,
  shown,
  rankWithoutTaste,
  rankWithoutTasteOf,
  earlier = null,
  onResult = () => {},
  Description = "p",
}: ClashDetailsProps) {
  const synthetic = preset.synthetic === true;
  const acts = useMemo(() => new Map(preset.festival.acts.map((act) => [act.id, act])), [preset]);
  const slots = useMemo(
    () => new Map(preset.festival.timetable.map((slot) => [slot.act_id, slot])),
    [preset],
  );
  const stages = useMemo(() => new Map(preset.festival.stages.map((stage) => [stage.id, stage])), [preset]);
  const actA = acts.get(shown.a.act_id);
  const actB = acts.get(shown.b.act_id);
  const requests = useMemo(
    () => (actA && actB ? requestsForActs(preset.requests, [actA, actB]) : []),
    [preset.requests, actA, actB],
  );
  const toolCalls = useMemo(() => traceToolCalls(requests, `${shown.a.act_id}-${shown.b.act_id}`), [requests, shown]);

  const slotA = slots.get(shown.a.act_id);
  const slotB = slots.get(shown.b.act_id);
  const receipt = receiptFor(preset.evidence, shown.a.act_id, shown.b.act_id);
  const fixed = isFixedByLocks(shown, (actId) => slots.get(actId)?.locked === true);
  const hiddenLine = preset.report.thresholds.hidden_overlap;
  const product = shown.audience_overlap * shown.concurrency * shown.draw;
  // The rarity factor (0.5 + mean rarity of the two acts) is whatever turns the three printed terms into the price.
  const rarityFactor = product > 0 ? shown.regret / product : null;
  const checkKey = pairCheckKey(preset.id, shown.a.act_id, shown.b.act_id);
  const withoutTaste = rankWithoutTaste
    ? withoutTasteLine(rankWithoutTaste(shown.a.act_id, shown.b.act_id), rankWithoutTasteOf, synthetic)
    : null;
  const counts = {
    search: requests.filter((r) => r.path.endsWith("/search")).length,
    insights: requests.filter((r) => r.path.endsWith("/insights")).length,
    compare: requests.filter((r) => r.path.endsWith("/analysis/compare")).length,
  };

  return (
    <>
      <Description className="max-w-prose text-[0.9375rem] leading-relaxed text-foreground">
        {shown.a.name} and {shown.b.name} play at the same time for {shown.overlap_minutes} minutes.
        Their taste overlap is {formatOverlap(shown.audience_overlap)} out of 100 (rank among the acts
        compared for this bill, {tasteSource(synthetic)}), so this clash takes{" "}
        {formatShare(shown.regret_share)} of the day&rsquo;s clash cost. Taste overlap is not
        attendance.
      </Description>
      {fixed ? (
        <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed text-muted-foreground">
          {bothLockedNote(synthetic)}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <ActPanel act={actA} slot={slotA} stage={stages.get(shown.a.stage_id)} synthetic={synthetic} />
        <ActPanel act={actB} slot={slotB} stage={stages.get(shown.b.stage_id)} synthetic={synthetic} />
      </div>

      {synthetic ? null : (
        <LiveRecheck
          key={checkKey}
          preset={preset}
          shown={shown}
          actA={actA}
          actB={actB}
          receipt={receipt}
          earlier={earlier}
          onResult={onResult}
        />
      )}

      <Section title="The score">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-5">
          <Figure
            label="Taste overlap"
            value={formatOverlap(shown.audience_overlap)}
            unit="/ 100"
            note="Rank among the acts compared for this bill. Not a share of fans."
            chip={<ProvenanceChip provenance="derived" size="sm" synthetic={synthetic} />}
          />
          <Figure
            label="Time shared"
            value={String(shown.overlap_minutes)}
            unit="min"
            note={`${formatPercent(shown.concurrency)} of the shorter set.`}
            chip={<ProvenanceChip provenance="derived" size="sm" synthetic={synthetic} />}
          />
          <Figure
            label="Combined draw"
            value={formatDraw(shown.draw)}
            unit="/ 100"
            note={`Both acts' draw (${popularityName(synthetic)}), combined as a geometric mean.`}
            chip={<ProvenanceChip provenance="derived" size="sm" synthetic={synthetic} />}
          />
          <Figure
            label="Share of day's cost"
            value={formatShare(shown.regret_share)}
            note="This clash's score over the sum of every scored clash today."
            chip={<ProvenanceChip provenance="derived" size="sm" synthetic={synthetic} />}
          />
        </dl>
        <p className="mt-5 rounded-md bg-background px-3 py-2.5 font-mono text-xs leading-relaxed">
          score = taste overlap {shown.audience_overlap.toFixed(3)} &times; share of the shorter set{" "}
          {shown.concurrency.toFixed(3)} &times; combined draw {shown.draw.toFixed(3)}
          {rarityFactor !== null ? ` × rarity factor ${rarityFactor.toFixed(3)}` : ""} ={" "}
          {shown.regret.toFixed(3)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{formulaNoteShort(synthetic)}</p>
        {withoutTaste ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{withoutTaste}</p>
        ) : null}
      </Section>

      <SavedRequests preset={preset} shown={shown} />

      <Section title="Label and confidence">
        {shown.label ? (
          <p className="text-[0.9375rem] leading-relaxed">
            <strong className="font-semibold">{LABEL_META[shown.label].name}.</strong>{" "}
            {LABEL_META[shown.label].explain}{" "}
            {shown.label === "hidden" && hiddenLine !== null
              ? `This day’s hidden-clash line is a taste overlap of ${formatOverlap(hiddenLine)} / 100.`
              : null}
          </p>
        ) : (
          <p className="text-[0.9375rem] leading-relaxed">
            <strong className="font-semibold">No label.</strong> Neither a hidden clash (different
            main genres, high taste overlap) nor a false one (same main genre, low taste overlap).
          </p>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          {signalSentence(synthetic, shown.confidence === "strong")}
        </p>
      </Section>

      {shown.label === "hidden" ? (
        <Section title="Why it is called hidden">
          <p className="text-[0.9375rem] leading-relaxed">{hiddenReason(shown)}</p>
        </Section>
      ) : null}

      <Section title={tagsTitle(synthetic)}>
        <PairTags
          receipt={receipt}
          hasEvidence={preset.evidence !== null}
          a={shown.a}
          b={shown.b}
          synthetic={synthetic}
        />
        {receipt?.press && isWebUrl(receipt.press) ? (
          <p className="mt-4 text-sm">
            Named in press coverage of this festival&rsquo;s clashes:{" "}
            <a
              href={receipt.press}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
            >
              {hostOf(receipt.press)}
              <ExternalLink aria-hidden="true" className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </p>
        ) : null}
      </Section>

      <Section title={usedTitle(synthetic)}>
        <p className="text-[0.9375rem] leading-relaxed">
          {synthetic ? (
            noRequestsLine(true)
          ) : requests.length > 0 ? (
            <>
              {pluralize(requests.length, "saved Qloo request")} sit behind this clash:{" "}
              {[
                counts.search ? pluralize(counts.search, "search", "searches") + " matching the acts" : null,
                counts.insights ? pluralize(counts.insights, "audience ranking") : null,
                counts.compare ? pluralize(counts.compare, "audience comparison") : null,
              ]
                .filter(Boolean)
                .join(", ")}
              .
            </>
          ) : (
            noRequestsLine(false)
          )}
        </p>
        {synthetic ? null : (
          <TraceDrawer
            toolCalls={toolCalls}
            mode="recorded"
            triggerClassName="mt-4"
            description={traceDescription(false)}
            footnote={`${preset.title} · ${shown.a.name} × ${shown.b.name}`}
          />
        )}
      </Section>
    </>
  );
}

/**
 * Details of one clash: both acts, the figures behind its price, its label and confidence, the
 * tags Qloo returned for the pair, a press link when there is one, and the Qloo requests behind it.
 * On an invented day it says the figures are invented, makes no live check and lists no requests.
 */
export function ClashDrawer({
  preset,
  clash: shown,
  open,
  ranked,
  onSelect,
  onClose,
  returnFocusTo,
  rankWithoutTaste,
  rankWithoutTasteOf,
}: ClashDrawerProps) {
  const slots = useMemo(
    () => new Map(preset.festival.timetable.map((slot) => [slot.act_id, slot])),
    [preset],
  );
  // Previous and next swap the clash inside an open drawer; start each one at the top.
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const shownKey = shown ? `${shown.day}:${clashKey(shown)}` : null;
  useEffect(() => {
    if (shownKey) detailsRef.current?.scrollTo({ top: 0 });
  }, [shownKey]);
  // Finished live checks, one per day and pair, so previous and next can come back to one. They
  // live as long as the drawer, across closing and reopening it.
  const [checks, setChecks] = useState<ReadonlyMap<string, PairCheck>>(() => new Map());
  const rememberCheck = useCallback((key: string, check: PairCheck) => {
    setChecks((previous) => new Map(previous).set(key, check));
  }, []);

  if (!shown) return null;

  const slotA = slots.get(shown.a.act_id);
  const slotB = slots.get(shown.b.act_id);
  const window = slotA && slotB ? overlapWindow(slotA, slotB) : null;
  const fixed = isFixedByLocks(shown, (actId) => slots.get(actId)?.locked === true);
  const index = ranked.findIndex((item) => item.rank === shown.rank && item.day === shown.day);
  const previous = index > 0 ? ranked[index - 1] : null;
  const next = index >= 0 && index < ranked.length - 1 ? ranked[index + 1] : null;
  const dayName = preset.festival.days[shown.day] ?? `Day ${shown.day + 1}`;
  const checkKey = pairCheckKey(preset.id, shown.a.act_id, shown.b.act_id);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        // The sheet sets the corners: square where it meets a screen edge (it fills a phone's screen), 14 px
        // on every corner from 640 px, where it floats inside the window.
        className="gap-0 p-0 data-[side=right]:lg:max-w-2xl"
        onCloseAutoFocus={(event) => {
          if (returnFocusTo && document.contains(returnFocusTo)) {
            event.preventDefault();
            // Never scroll the page to the trigger: closing must leave the reader where they were.
            returnFocusTo.focus({ preventScroll: true });
          }
        }}
      >
        <SheetHeader className="gap-0 border-b border-border p-5 pr-14 sm:p-6 sm:pr-16">
          <p className="text-[0.8125rem] font-semibold text-muted-foreground">
            Clash {shown.rank} of {ranked.length} · {dayName}
            {window ? ` ${formatRange(window)}` : ""}
          </p>
          <SheetTitle className="type-headline mt-2 text-balance break-words">
            {shown.a.name} <span className="text-muted-foreground">&times;</span> {shown.b.name}
          </SheetTitle>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {shown.label ? <LabelBadge label={shown.label} /> : null}
            {fixed ? (
              <span className="tag text-foreground">
                <Lock aria-hidden="true" className="size-3" />
                {bothLockedLabel(preset.synthetic === true)}
              </span>
            ) : null}
            <span className="tag text-foreground">
              {shown.confidence === "strong" ? "Strong signal" : "Weak signal"}
            </span>
          </div>
        </SheetHeader>

        <div
          ref={detailsRef}
          tabIndex={0}
          role="region"
          aria-label="Clash details"
          // Its focus ring sits just inside its edges, so the sheet's clip never cuts it.
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 focus-visible:-outline-offset-2 sm:px-6"
        >
          <ClashDetails
            key={checkKey}
            preset={preset}
            shown={shown}
            rankWithoutTaste={rankWithoutTaste}
            rankWithoutTasteOf={rankWithoutTasteOf}
            earlier={checks.get(checkKey) ?? null}
            onResult={rememberCheck}
            Description={SheetDescription}
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-popover px-5 py-3 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            disabled={!previous}
            onClick={() => previous && onSelect(previous)}
          >
            <ArrowLeft aria-hidden="true" />
            {previous ? `Clash ${previous.rank}` : "Previous"}
          </Button>
          <Button variant="ghost" size="sm" disabled={!next} onClick={() => next && onSelect(next)}>
            {next ? `Clash ${next.rank}` : "Next"}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
