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
  "Our guess, not yet tested: the festival, through its head of programming, once per edition, before set times go out. The pilot below is how we will find out.";

/** What the readings must never be used for, on /method's limits and on the brief (screen and print). */
export const DO_NOT_USE =
  "Do not use this to set fees, billing order or an artist’s worth, or for crowd capacity, safety or attendance.";

/**
 * The pilot's stated limits, as the offer prints them. A bill is checked in the browser, then its
 * longest overlaps are priced live: at most 35 requests for a grid (one search per act and one audience
 * ranking per act in a priced pair) plus a 3-request re-check of the chosen move, so about 40. The
 * month's allowance is the entry's shared Qloo quota.
 */
export const PILOT = {
  bills: 10,
  requestsPerBill: 40,
  monthlyRequests: 10_000,
} as const;
