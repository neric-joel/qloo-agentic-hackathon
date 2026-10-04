/**
 * Who a figure is credited to, on a published day and on the invented one. The server serves an invented
 * day (`synthetic: true`) when it has no built preset; nothing on it comes from Qloo, so every component
 * that would credit Qloo reads the flag and switches to the wording here. Denials ("no Qloo request was
 * made") are allowed on the invented day; credits are not. Pure strings and small functions, so they are
 * unit tested, and the render sweep in `credit.test.ts` mounts each component with an invented day.
 */

import { METHOD_FIGURES } from "./method-figures";

/** The label of a draw figure: "Draw (Qloo popularity)" on a published day. */
export function drawLabel(synthetic: boolean): string {
  return synthetic ? "Draw (invented popularity)" : "Draw (Qloo popularity)";
}

/** "Qloo popularity" or "invented popularity": what a set's draw is called in running text. */
export function popularityName(synthetic: boolean): string {
  return synthetic ? "invented popularity" : "Qloo popularity";
}

/** The legend and set-block label for a set with no usable signal, "No Qloo signal". */
export function noSignalLabel(synthetic: boolean): string {
  return synthetic ? "No priced signal" : "No Qloo signal";
}

/** The same label inside a sentence: "weak signal" is neutral; a missing one is "no usable signal". */
export function weakSignalLabel(synthetic: boolean): string {
  return synthetic ? "Weak signal." : "Weak Qloo signal.";
}

/** The legend's entry for a set that is left out of every price. */
export function legendNoSignal(synthetic: boolean): string {
  return `${noSignalLabel(synthetic)}: left out, not scored as zero`;
}

/** The clash drawer's opening sentence, after the taste-overlap figure: where the rank comes from. */
export function tasteSource(synthetic: boolean): string {
  return synthetic ? "an invented figure for an invented day" : "calculated from Qloo data";
}

/** What "Strong signal" and "Weak signal" mean in the drawer. */
export function signalSentence(synthetic: boolean, strong: boolean): string {
  if (synthetic) {
    return strong
      ? "Strong signal: the day’s figures for both acts are complete."
      : "Weak signal: the figures for at least one act are thin, so read this price as rough.";
  }
  return strong
    ? "Strong signal: Qloo has a strong signal for both acts."
    : "Weak signal: Qloo's signal for at least one act is weak, so read this price as rough.";
}

/** The drawer's title over the pair's tags. */
export function tagsTitle(synthetic: boolean): string {
  return synthetic ? "Shared tags for this pair" : "Tags Qloo returned for this pair";
}

/** The line under a pair's tags. */
export function tagsSource(synthetic: boolean): string {
  return synthetic
    ? "Tags are invented for this day; no audience comparison was run."
    : "Tags Qloo returned when it compared the two acts’ audiences.";
}

/** The drawer's section on where the requests came from. */
export function usedTitle(synthetic: boolean): string {
  return synthetic ? "Where the figures came from" : "How Qloo was used";
}

/** What the drawer says about the requests behind a pair, when there are none. */
export function noRequestsLine(synthetic: boolean): string {
  return synthetic
    ? "No Qloo request was made for this day: its figures are invented."
    : "No saved Qloo requests are linked to this pair.";
}

/** The trace drawer's description under the drawer's request list. */
export function traceDescription(synthetic: boolean): string {
  return synthetic
    ? "The invented day has no requests to replay: no Qloo request was made for it."
    : "The Qloo requests behind this clash, replayed from the saved preset rather than fetched live. The API key stays on the server and is never sent to the browser.";
}

/** The coverage strip's heading. */
export function coverageHeading(synthetic: boolean): string {
  return synthetic ? "Signal coverage" : "Qloo coverage";
}

/** The coverage strip's label for acts with no signal, in its breakdown. */
export function coverageNone(synthetic: boolean): string {
  return synthetic ? "no signal" : "no Qloo signal";
}

/** "(no usable Qloo signal; hatched below)". */
export function coverageUnscored(synthetic: boolean): string {
  return synthetic ? "no usable signal; hatched below" : "no usable Qloo signal; hatched below";
}

/** The coverage strip when no act is left out. */
export function coverageAll(synthetic: boolean): string {
  return synthetic ? "Every act on this day has a signal" : "Every act on this day has a Qloo signal";
}

/** The try-a-move card's line for a set that has no signal. */
export function noSignalMove(synthetic: boolean, act: string): string {
  return synthetic
    ? `${act} has no usable signal on this day, so its clashes are not priced and no place changes the Clash Budget Index.`
    : `Qloo has no usable signal for ${act}, so its clashes are not priced and no place changes the Clash Budget Index.`;
}

/** The agent panel's first suggested question. */
export function explainPrompt(synthetic: boolean): string {
  return synthetic
    ? "Explain why two sets clash, with the taste the day’s figures say both audiences share."
    : "Explain why two sets clash, with the taste Qloo finds both audiences share.";
}

/** The agent panel's introduction. */
export function agentDataLine(synthetic: boolean): string {
  return synthetic ? "with the same invented figures" : "with the same Qloo data";
}

// ------------------------------------------------------------------------------------ the price

/** What "counts only what clashes cost" lists; the rarity factor is neutral on the two published days. */
export const COUNTS_ONLY =
  "It counts only what clashes cost: taste overlap, time shared, draw and a rarity factor.";

/** `COUNTS_ONLY` with the clause that says why rarity moves nothing on the published days. */
export const COUNTS_ONLY_NEUTRAL = `${COUNTS_ONLY.slice(0, -1)} (rarity is neutral on the two published days).`;

/** "0.9, 0.7, 0.5 and 0.3": the stand-in draw by billing tier, from the pinned figures. */
export function drawPriorList(): string {
  const prior = METHOD_FIGURES.price.drawPrior;
  const values = [prior[1], prior[2], prior[3], prior[4]].map((value) => value.toFixed(1));
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/**
 * The note that goes with every printed formula: the factors are on a 0 to 1 scale (taste overlap and draw
 * are shown out of 100), they are rounded when printed so they may not multiply to the printed price, and an
 * act with no popularity takes a stand-in draw by billing tier (`DRAW_PRIOR` in the engine).
 */
export function formulaNote(synthetic: boolean): string {
  const { scaleFactor } = METHOD_FIGURES.price;
  return (
    `The factors are on a ${scaleFactor[0]} to ${scaleFactor[1]} scale (taste overlap and draw are shown out of 100 elsewhere on the page) ` +
    `and are rounded when printed, so they may not multiply to exactly the printed price. ` +
    `An act with no ${synthetic ? "popularity figure" : "Qloo popularity"} takes a stand-in draw set by its billing tier ` +
    `(${drawPriorList()} for tiers 1 to 4).`
  );
}

/** The shorter form for a card where room is tight (the drawer's formula line). */
export function formulaNoteShort(synthetic: boolean): string {
  const { scaleFactor } = METHOD_FIGURES.price;
  return (
    `Factors are on a ${scaleFactor[0]} to ${scaleFactor[1]} scale and rounded when printed, so they may not multiply to exactly the price. ` +
    `An act with no ${synthetic ? "popularity figure" : "Qloo popularity"} takes a stand-in draw by billing tier (see How we know).`
  );
}

/** The note a published day's page makes about where its figures were built from. */
export const BUILT_FROM_REAL =
  "The festival days shown were built from saved Qloo responses; the festivals themselves do not use Clash Control.";

/** The same note on the invented day. */
export const BUILT_FROM_SYNTHETIC =
  "This server is showing an invented example day: its figures are invented and no Qloo request was made.";

// ------------------------------------------------------------------------------------ the sweep

/** Phrases that deny a Qloo source: they may appear on the invented day. */
const DENIALS: readonly RegExp[] = [
  /no Qloo request was made/gi,
  /no request was (?:sent|made) to Qloo/gi,
  /no Qloo (?:data|reading|signal is involved|responses?)/gi,
  /not endorsed by Qloo/gi,
  /not a saved Qloo response/gi,
  /not Qloo(?:’|')s/gi,
  /no (?:saved )?Qloo requests? (?:was|were|is|are) (?:made|linked)/gi,
];

/** The sentences of `text` that still credit Qloo once the denials are taken out. Empty when there are none. */
export function qlooCredits(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => DENIALS.reduce((rest, denial) => rest.replace(denial, ""), sentence))
    .filter((sentence) => /Qloo/i.test(sentence));
}
