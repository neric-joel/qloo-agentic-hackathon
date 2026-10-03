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
