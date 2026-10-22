/**
 * How long the clash job takes, for /method's "How long this takes" block
 * (`_private/research/2026-10-22/timing/timing.md`, checked by a second pass on 22 Oct 2026).
 *
 * Three things, never added to or set against each other:
 * - the by-hand route, estimated with a Keystroke-Level Model (estimated, not measured: nobody was timed);
 * - what existing tools say on their public pages (no time for this job anywhere);
 * - Clash Control's steps, timed by the demo driver as machine time on production (system response, not a
 *   person's time), in `PRODUCTION_TIMING`; without figures, each step says when it will be measured.
 */

import { evidenceSource } from "./public-evidence";

/** The anchor of the block on /method. */
export const TIMING_ID = "how-long";
export const TIMING_TITLE = "How long this takes";

/** The label every by-hand figure carries. */
export const ESTIMATED_LABEL = "Estimated, not measured";

/** The example day the estimate is for (counted from the saved day file). */
export const TIMING_DAY = {
  name: "Glastonbury 2025 Sunday",
  sets: 39,
  stages: 5,
  pairs: 79,
} as const;

/** The Keystroke-Level Model estimate in minutes, low / typical / high, for steps 1 to 4 and each step. */
export const MANUAL_MINUTES = {
  total: [6.4, 12.3, 22.0],
  steps: [
    {
      step: "List every overlapping pair with its minutes shared",
      minutes: [3.3, 6.6, 11.3],
    },
    {
      step: "Judge which clashes cost the audience most, by genre or gut",
      minutes: [2.2, 4.4, 8.9],
    },
    {
      step: "Pick one move and check stage hours, curfew, changeover and locked sets",
      minutes: [0.3, 0.5, 0.7],
    },
    {
      step: "Re-check the overlaps the move changes",
      minutes: [0.5, 0.7, 1.1],
    },
  ],
  /** Share of the typical estimate that is the model's allowance for thinking (486 of 739 seconds). */
  mentalPct: 66,
} as const;

/** The by-hand estimate in one paragraph, its label first. */
export const MANUAL_SENTENCE = `${ESTIMATED_LABEL}: a Keystroke-Level Model puts the by-hand route at 6 to 22 minutes for ${TIMING_DAY.name} (${TIMING_DAY.sets} sets on ${TIMING_DAY.stages} stages, ${TIMING_DAY.pairs} overlapping pairs), about 12 in a typical case. It assumes an expert who already has the grid in a spreadsheet and makes no mistakes. About two-thirds of it is the model's rough allowance for thinking, so a real person could take more or less time. Nobody was timed.`;

/** Where the model and its operator times come from. */
export const MANUAL_SOURCES = [
  {
    label: "Card, Moran and Newell, 1980 (Communications of the ACM)",
    url: "https://doi.org/10.1145/358886.358895",
  },
  {
    label: "Keystroke-level model operator times",
    url: "https://en.wikipedia.org/wiki/Keystroke-level_model",
  },
] as const;

/** What existing tools say, from their public pages read on 22 Oct 2026. */
export const TOOLS_SENTENCE =
  "In the public pages we read, none of these tools gives a time for this job, and none ranks clashing pairs on a draft grid by how close their audiences are. Ticket Fairy and Lineup Ninja already check overlaps and changeovers, and Ticket Fairy checks curfews too. Setline reads attendee interest once times are live. One Ticket Fairy blog calls scheduling a whole lineup by hand “many weeks”, with no figure behind it.";

export const TOOL_LINKS = [
  { label: "Clashfinder", url: "https://clashfinder.com/" },
  {
    label: "Festival Pro schedules",
    url: "https://festivalpro.com/features/schedules.html",
  },
  {
    label: "Lineup Ninja scheduling",
    url: "https://docs.lineup.ninja/agenda/scheduling/",
  },
  { label: "Setline for organisers", url: "https://setlineapp.com/organisers" },
  {
    label: "Ticket Fairy line-up and running order",
    url: "https://www.ticketfairy.com/event-operating-system/artists-and-line-up/line-up-and-running-order.md",
  },
  {
    label: "Ticket Fairy blog on data-driven scheduling",
    url: evidenceSource("V02").url,
  },
] as const;

export type MachineStep = "load" | "open" | "move" | "keep" | "print";

/** Clash Control's steps on the saved Glastonbury day, as the demo driver times them. */
export const MACHINE_STEPS: readonly {
  readonly id: MachineStep;
  readonly step: string;
}[] = [
  { id: "load", step: "Load the day" },
  { id: "open", step: "Open the costliest clash" },
  { id: "move", step: "Show the tested move" },
  { id: "keep", step: "Keep this move" },
  { id: "print", step: "Print the brief" },
];

export type ProductionTiming = {
  /** When, on which build, and how many runs, cold or warm: e.g. "23 Oct 2026, build abc1234, median of 10 warm runs". */
  readonly measured: string;
  /** Each step's machine time as printed, e.g. "1.2 s". */
  readonly steps: Readonly<Record<MachineStep, string>>;
};

/**
 * The demo driver's timing script on production (`_private/demo/final/machine-timing.json`): each step from the
 * action to its result on screen, the median of 10 warm runs after one discarded warm-up, every live route
 * blocked. While this is null, every step prints `TIMING_PENDING` and no number.
 */
export const PRODUCTION_TIMING: ProductionTiming | null = {
  measured: "Measured on 22 Oct 2026 on build 0d328cb: the median of 10 warm runs, each step from the action to its result on screen.",
  steps: { load: "0.8 s", open: "0.2 s", move: "0.1 s", keep: "0.4 s", print: "0.9 s" },
};

/** What a step says until the driver's figures are in. */
export const TIMING_PENDING = "measured on production during the final demo recording";

/** The label every Clash Control figure carries. */
export const MACHINE_LABEL = "Machine time on production";

/** One step's line: its machine time, or when it will be measured. */
export function machineTimeLine(step: MachineStep, timing: ProductionTiming | null = PRODUCTION_TIMING): string {
  return `${MACHINE_LABEL}: ${timing ? timing.steps[step] : TIMING_PENDING}`;
}

/** What the machine times are and what they are not. */
export const MACHINE_NOTE =
  "Machine time is how long the site took to respond, timed by a script. It is not a person's time, and it is never set against the estimate above. Listing pairs and checking rules is arithmetic any tool can do; what Qloo adds is a different way to rank the clashes, not speed.";
