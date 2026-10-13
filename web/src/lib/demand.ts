/**
 * What the entry knows about who would use it, as one value the owner edits (never a builder).
 * "pending" is the default and prints only that who would pay is not known; "none" and "reply"
 * carry real counts the owner writes in after the outreach window.
 */

export type Demand =
  | { status: "pending" }
  | { status: "none"; asked: number; dates: string; checkedOn: string }
  | {
      status: "reply";
      asked: number;
      replied: number;
      dates: string;
      role: string;
      quote: string;
      changed: string | null;
    };

export const DEMAND = { status: "pending" } as Demand;

/**
 * Where a programmer sends a bill for the pilot: an address or a page the owner supplies. Null until
 * the owner writes it in; the offer then points at the Devpost page instead.
 */
export const PILOT_CONTACT = null as string | null;

/**
 * The pilot's terms, printed in the open under the offer once the owner has confirmed them; they are promises in his
 * name. Null until then, and nothing is printed.
 */
export const PILOT_TERMS: string | null = null;

/** Who we guess would pay, said as a guess right after "Who would pay is not known." */
export const PAYER_GUESS =
  "Our guess, not yet tested: the festival’s head of programming, once per edition, before set times go out.";

/** What the readings must never be used for, on /method's limits and on the brief (screen and print). */
export const DO_NOT_USE =
  "Do not use this to set fees, billing order or an artist’s worth, or for crowd capacity, safety or attendance.";

/**
 * What pricing a new bill would cost, as the pilot's fold prints it. The pilot itself offers only what costs no
 * Qloo request (a walk through a published day's brief, and rule checks that run in the browser); pricing a new
 * bill is not offered, and would run only with the festival's OK. Comparing a bill's longest overlaps through
 * /check: at most 35 requests for a grid (one search per act and one audience ranking per act in a priced pair)
 * plus a 3-request re-check of the chosen move, so about 40. A full-day reading: the request records of the two
 * published days' builds (Glastonbury 2025 Sunday, Riot Fest 2026 Sunday). The month's allowance is the entry's
 * shared Qloo quota.
 */
export const PILOT = {
  requestsPerBill: 40,
  monthlyRequests: 10_000,
  fullDayRequests: [104, 70],
} as const;
