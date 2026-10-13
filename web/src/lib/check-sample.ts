/**
 * An invented day for "Check an invented sample" on the check page: the 24 acts of the invented example day the
 * API serves when no festival day is built (Lanternfield, four stages), as a draft grid of 25 sets. The
 * act names come from this repo's synthetic generator (random word pairs); no real festival and no
 * real act is meant, and no Qloo data is in them. Because they are that day's acts, "Price" on the
 * sample is answered from the invented day without a Qloo request, on any clone.
 *
 * Exactly four findings are planted, so the first result is a visible list:
 * - an act on two stages at once: Orchid Bloom, Grove Stage 16:40 and Night Tent 16:30;
 * - a short changeover: Willow Circuit ends 18:55 and Neon Garden starts 19:05 on the Grove Stage;
 * - a set past the 00:00 curfew: Rustic Harbour ends 00:20 on the Night Tent;
 * - a pair listed as never overlapping that shares 20 minutes: Saffron Season and Ivory Lights.
 * Every other gap on a stage is 20 minutes or more and no two sets on one stage overlap.
 */

import { numberWord } from "./method-figures";

export const SAMPLE_GRID = [
  "act,stage,start,end,locked",
  "Tidal Fields,Main Stage,10:25,11:10,",
  "Juniper Bloom,Main Stage,11:40,12:35,",
  "Crimson Season,Main Stage,13:20,14:35,",
  "Marble Syndicate,Main Stage,15:15,16:25,",
  "Brass Choir,Main Stage,16:55,18:35,yes",
  "Glass Mirror,Main Stage,19:20,20:50,yes",
  "Fable Pilots,Main Stage,21:20,23:00,yes",
  "Willow Bloom,Riverside Stage,14:10,14:50,",
  "Echo Mirror,Riverside Stage,15:25,16:05,",
  "Saffron Season,Riverside Stage,16:40,17:40,",
  "Cobalt Choir,Riverside Stage,18:05,19:05,",
  "Marble Machine,Riverside Stage,19:25,20:45,",
  "Rustic Season,Riverside Stage,21:15,22:30,",
  "Cedar Roads,Grove Stage,14:15,15:00,",
  "Harbor Atlas,Grove Stage,15:25,16:05,",
  "Orchid Bloom,Grove Stage,16:40,17:20,",
  "Willow Circuit,Grove Stage,17:55,18:55,",
  "Neon Garden,Grove Stage,19:05,20:05,",
  "Fable Meadow,Grove Stage,20:40,22:00,",
  "Orchid Bloom,Night Tent,16:30,17:00,",
  "Ivory Lights,Night Tent,17:20,18:05,",
  "Cobalt Hours,Night Tent,18:25,19:10,",
  "Hollow Meadow,Night Tent,19:45,20:40,",
  "Neon Harbour,Night Tent,21:05,22:05,",
  "Rustic Harbour,Night Tent,23:20,00:20,",
  "",
].join("\n");

export const SAMPLE_SETTINGS = {
  changeover: "15",
  curfew: "00:00",
  pairs: "Saffron Season | Ivory Lights",
} as const;

/** The four planted findings listed above. */
export const SAMPLE_PLANTED_BREAKS = 4;

/** Sets in the sample grid: its lines, less the header. */
export const SAMPLE_SET_COUNT = SAMPLE_GRID.split("\n").filter((line) => line.trim() !== "").length - 1;

/** Shown above the results, and printed on the brief, while the checked grid is this sample. */
export const SAMPLE_LABEL = `Invented sample: ${SAMPLE_SET_COUNT} sets with ${numberWord(SAMPLE_PLANTED_BREAKS)} planted rule breaks.`;

/** True when every field holds exactly what "Check an invented sample" fills in. */
export function isSampleInput(input: { grid: string; changeover: string; curfew: string; pairs: string }): boolean {
  return (
    input.grid === SAMPLE_GRID &&
    input.changeover === SAMPLE_SETTINGS.changeover &&
    input.curfew === SAMPLE_SETTINGS.curfew &&
    input.pairs === SAMPLE_SETTINGS.pairs
  );
}
