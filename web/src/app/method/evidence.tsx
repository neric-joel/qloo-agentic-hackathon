import { MoreDetails } from "@/components/clash/more-details";
import {
  EVIDENCE_CLAIMS,
  EVIDENCE_INTRO,
  EVIDENCE_LIMITS,
  EVIDENCE_METHOD,
  EVIDENCE_QUESTIONS,
  EVIDENCE_SOURCE_GROUPS,
  evidenceSource,
  sourceName,
} from "@/lib/public-evidence";
import {
  MACHINE_NOTE,
  MACHINE_STEPS,
  MANUAL_MINUTES,
  MANUAL_SENTENCE,
  MANUAL_SOURCES,
  PRODUCTION_TIMING,
  TOOL_LINKS,
  TOOLS_SENTENCE,
  machineTimeLine,
  type ProductionTiming,
} from "@/lib/timing-figures";

/** The page's text link: ink, a 1px border-strong underline 4px off the text, ink on hover. */
const TEXT_LINK = "underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-foreground";
/** Hairline rows, like the lines of a running order (the limits list's own rows). */
const ROWS = "[&>li]:border-t [&>li]:border-border [&>li]:py-2";
/** A small label over a block of the section. */
const LABEL = "text-base leading-snug font-semibold";

/** An outside page, opening in a new tab, named for screen readers as doing so. */
function OutLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Minutes as printed: one decimal. */
const min = (value: number) => value.toFixed(1);

/**
 * "What people ask about clashes": the analysis of public pages. Its intro (what was read, that nobody was asked,
 * that it counts pages), the three verified claims in the open, then each question the pages raise as a closed
 * disclosure with what the pages show, how Clash Control helps, where it does not and three pages behind it, then
 * the method and limits in the open, and every source behind one click. Server-rendered.
 */
export function AskedBody() {
  return (
    <>
      <p data-evidence-intro>{EVIDENCE_INTRO}</p>
      <h3 className={LABEL}>What the pages show</h3>
      <ul data-evidence-claims className={ROWS}>
        {EVIDENCE_CLAIMS.map((claim) => (
          <li key={claim.id}>{claim.sentence}</li>
        ))}
      </ul>
      <h3 className={LABEL}>The questions, most raised first</h3>
      <div data-evidence-questions>
        {EVIDENCE_QUESTIONS.map((q) => (
          <MoreDetails key={q.id} summary={q.question} hint={`${q.pages} pages`}>
            <div className="space-y-2 pb-4">
              <p>
                <span className="font-semibold">What the pages show.</span> {q.shows}
              </p>
              <p>
                <span className="font-semibold">How Clash Control helps.</span> {q.helps}
              </p>
              <p>
                <span className="font-semibold">Where it does not.</span> {q.notHelp}
              </p>
              <p className="text-sm text-muted-foreground">
                Pages:{" "}
                {q.keySources.map((id, i) => {
                  const source = evidenceSource(id);
                  return (
                    <span key={id}>
                      {i > 0 ? "; " : null}
                      <OutLink href={source.url}>{sourceName(source)}</OutLink>
                    </span>
                  );
                })}
              </p>
            </div>
          </MoreDetails>
        ))}
      </div>
      <h3 className={LABEL}>How we read them, and the limits</h3>
      <p data-evidence-method>{EVIDENCE_METHOD}</p>
      <ul data-evidence-limits className={ROWS}>
        {EVIDENCE_LIMITS.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
      <MoreDetails summary="Sources for this analysis">
        <div className="space-y-4 pb-4">
          {EVIDENCE_SOURCE_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-sm font-semibold">{group.title}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {group.ids.map((id) => {
                  const source = evidenceSource(id);
                  return (
                    <li key={id} className="min-w-0 break-words">
                      <OutLink href={source.url}>{sourceName(source)}</OutLink>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </MoreDetails>
    </>
  );
}

/**
 * "How long this takes": the by-hand estimate under its "Estimated, not measured" label with its four steps and
 * the model's sources, what existing tools' public pages say (with links), and Clash Control's steps, each as
 * machine time on production from `PRODUCTION_TIMING` or, until the demo driver fills it, when it will be measured.
 * The three are never added or compared. Server-rendered.
 */
export function TimingBody({ timing = PRODUCTION_TIMING }: { timing?: ProductionTiming | null }) {
  const [low, typical, high] = MANUAL_MINUTES.total;
  return (
    <>
      <h3 className={LABEL}>By hand</h3>
      <p data-timing-manual>{MANUAL_SENTENCE}</p>
      <ul data-timing-steps className={ROWS}>
        {MANUAL_MINUTES.steps.map(({ step, minutes: [a, b, c] }) => (
          <li key={step}>
            {step}: {min(a)} to {min(c)} min, typical {min(b)} (estimated)
          </li>
        ))}
        <li className="font-semibold">
          All four: {min(low)} to {min(high)} min, typical {min(typical)} (estimated)
        </li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Model:{" "}
        {MANUAL_SOURCES.map((source, i) => (
          <span key={source.url}>
            {i > 0 ? "; " : null}
            <OutLink href={source.url}>{source.label}</OutLink>
          </span>
        ))}
      </p>
      <h3 className={LABEL}>Existing tools</h3>
      <p data-timing-tools>{TOOLS_SENTENCE}</p>
      <p className="text-sm text-muted-foreground">
        Pages read:{" "}
        {TOOL_LINKS.map((tool, i) => (
          <span key={tool.url}>
            {i > 0 ? "; " : null}
            <OutLink href={tool.url}>{tool.label}</OutLink>
          </span>
        ))}
      </p>
      <h3 className={LABEL}>Clash Control, on the saved Glastonbury day</h3>
      <ul data-timing-machine className={ROWS}>
        {MACHINE_STEPS.map(({ id, step }) => (
          <li key={id}>
            {step}. {machineTimeLine(id, timing)}.
          </li>
        ))}
      </ul>
      {timing ? <p className="text-sm text-muted-foreground">{timing.measured}</p> : null}
      <p data-timing-note>{MACHINE_NOTE}</p>
    </>
  );
}
