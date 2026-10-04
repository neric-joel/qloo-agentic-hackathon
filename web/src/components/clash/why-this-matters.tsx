import Link from "next/link";

import { DEMAND, type Demand } from "@/lib/demand";
import { METHOD_FIGURES, formatAuc, formatPct, methodRow } from "@/lib/method-figures";
import { PUBLIC_VOICES } from "@/lib/public-voices";

/** The anchor of the section, for links that point at it. */
export const WHY_THIS_MATTERS_ID = "why-this-matters";

const LINK = "font-semibold underline underline-offset-4 hover:text-primary";

function DemandLine({ demand }: { demand: Demand }) {
  if (demand.status === "pending") return null;
  if (demand.status === "none") {
    return (
      <p className="mt-3">
        We asked {demand.asked} festival programmers between {demand.dates}; none had replied by {demand.checkedOn}.
      </p>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-border-strong p-3">
      <p className="type-kicker text-muted-foreground">One programmer told us</p>
      <p className="mt-1.5 text-muted-foreground">
        Asked {demand.asked}, replied {demand.replied}. {demand.dates}.
      </p>
      <blockquote className="mt-2 break-words">{demand.quote}</blockquote>
      <p className="mt-1.5 text-muted-foreground">{demand.role}</p>
      <p className="mt-2">Changed because of this reply: {demand.changed ?? "Nothing changed."}</p>
    </div>
  );
}

/**
 * What is public about the problem and what is not known, between the jump nav and the timetable.
 * The complaint counts and the failed pre-set test are read from `METHOD_FIGURES`, and the failed
 * test sits in the same block as the complaint count it belongs to. The voices are linked
 * paraphrases and are problem evidence only: they say clashes are a known problem, not that anyone
 * would use or pay for this tool. Server-rendered; nothing here needs JavaScript.
 */
export function WhyThisMatters({ demand = DEMAND }: { demand?: Demand }) {
  const { complaints, backtest } = METHOD_FIGURES;
  const taste = methodRow("taste");
  const popularity = methodRow("popularity");
  return (
    <section aria-labelledby="why-this-matters-heading" id={WHY_THIS_MATTERS_ID} className="border-t border-border">
      <div className="container-page py-10 sm:py-12">
        <h2 id="why-this-matters-heading" className="type-title">
          Why this matters, and what is not known
        </h2>
        <div className="mt-6 grid gap-8 text-sm leading-relaxed lg:grid-cols-3 lg:gap-6">
          <div className="min-w-0">
            <h3 className="type-kicker text-muted-foreground">The problem is public.</h3>
            <p className="mt-2">
              {complaints.clustersVerified} clashes that fans or the press complained about at {complaints.festivals}{" "}
              festivals had a verified overlap in time; across them, {complaints.pairsVerified} pairs of acts, median{" "}
              {complaints.medianMinutes} minutes. Press lists lean toward headliners, which flatters any taste-based
              method.
            </p>
            <p className="mt-3">
              <strong className="font-semibold">The test we set before looking failed.</strong> {formatPct(taste.topQuarterPct)}{" "}
              of the complained-about clashes ranked in the top quarter of their day by taste overlap, against a bar of{" "}
              {backtest.bar.topQuarterPct}%. An exploratory follow-up on those published festivals puts taste overlap at an AUC of {formatAuc(taste.auc)}{" "}
              on this press-skewed set; on the same set, popularity, also a Qloo field, scores {formatAuc(popularity.auc)}.{" "}
              <Link href="/method" className={LINK}>
                How we know
              </Link>
            </p>
          </div>

          <div className="min-w-0">
            <h3 className="type-kicker text-muted-foreground">What programmers have said in public.</h3>
            <ul className="mt-2 space-y-2.5">
              {PUBLIC_VOICES.map((voice) => (
                <li key={voice.who}>
                  <span className="font-semibold">{voice.who}:</span> {voice.said}{" "}
                  <span className="whitespace-nowrap text-muted-foreground">
                    (
                    {voice.links.map((link, i) => (
                      <span key={link.href}>
                        {i > 0 ? "; " : ""}
                        <a href={link.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                          {link.label}
                        </a>
                      </span>
                    ))}
                    )
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-muted-foreground">
              These show that clashes are a known problem. They do not show that anyone would use or pay for this.
            </p>
          </div>

          <div className="min-w-0">
            <h3 className="type-kicker text-muted-foreground">What exists, and what is not known.</h3>
            <p className="mt-2">
              Festival schedulers such as Festival Pro and Lineup Ninja check double bookings and changeovers. We found
              none that reads audience overlap (our search, October 2026: absence of evidence only). Who would pay is not
              known. The first test is smaller than a sale: does a programmer move a set, or keep one on purpose, after
              seeing the reading?
            </p>
            <DemandLine demand={demand} />
          </div>
        </div>
      </div>
    </section>
  );
}
