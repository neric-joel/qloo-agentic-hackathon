/**
 * An invented day for "Load a sample" on the check page: Lanternfield, three stages, 21 sets.
 * The act names were drawn once from this repo's synthetic generator (random word pairs); no real
 * festival and no real act is meant, and nothing here comes from the preset modules or any API.
 *
 * Exactly four findings are planted, so the first result is a visible list:
 * - a short changeover: Willow Lights ends 19:45 and Cedar Orchard starts 19:55 on the Night Tent;
 * - a set past the 00:00 curfew: Mosaic Syndicate ends 00:20 on the Lantern Stage;
 * - an act on two stages at once: Quiet Voltage, Lantern Stage 16:30 and Night Tent 16:15;
 * - a pair listed as never overlapping that shares 25 minutes: Lunar Roads and Copper Circuit.
 * Every other gap is 25 minutes or more and no two sets on one stage overlap.
 */

export const SAMPLE_GRID = [
  "act,stage,start,end,locked",
  "Tidal Machine,Lantern Stage,14:00,14:45,",
  "Harbor Bloom,Lantern Stage,15:15,16:00,",
  "Quiet Voltage,Lantern Stage,16:30,17:20,",
  "Ember Parade,Lantern Stage,17:50,19:10,",
  "Copper Circuit,Lantern Stage,19:35,20:50,yes",
  "Echo Machine,Lantern Stage,21:20,22:35,",
  "Mosaic Syndicate,Lantern Stage,23:00,00:20,",
  "Cedar Lights,Orchard Stage,13:30,14:15,",
  "Harbor Orchard,Orchard Stage,14:45,15:30,",
  "Velvet Ghosts,Orchard Stage,16:00,16:50,",
  "Sable Mirror,Orchard Stage,17:25,18:25,",
  "Lunar Roads,Orchard Stage,19:00,20:00,",
  "Ember Mirror,Orchard Stage,20:35,21:35,",
  "Quiet Parade,Orchard Stage,22:10,23:20,",
  "Solar Harvest,Night Tent,15:00,15:45,",
  "Quiet Voltage,Night Tent,16:15,17:00,",
  "Echo Sparrows,Night Tent,17:30,18:20,",
  "Willow Lights,Night Tent,18:50,19:45,",
  "Cedar Orchard,Night Tent,19:55,20:50,",
  "Sable Season,Night Tent,21:20,22:20,",
  "Velvet Machine,Night Tent,22:50,23:50,",
  "",
].join("\n");

export const SAMPLE_SETTINGS = {
  changeover: "15",
  curfew: "00:00",
  pairs: "Lunar Roads | Copper Circuit",
} as const;
