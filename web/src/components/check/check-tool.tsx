"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Download, FileText, Lock, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CHECK_COPY,
  CHECK_LIMITS,
  TEMPLATE_CSV,
  announcement,
  runCheck,
  type CheckInput,
  type CheckOutcome,
} from "@/lib/check";
import { SAMPLE_GRID, SAMPLE_SETTINGS } from "@/lib/check-sample";

import { CheckResults } from "./check-results";

const FIELD =
  "mt-1.5 w-full min-w-0 rounded-md border border-border-strong bg-card px-3 text-[0.9375rem] text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type Run = { nonce: number; outcome: CheckOutcome; note: string };

const EMPTY: CheckInput = { grid: "", changeover: "", curfew: "", pairs: "" };

/**
 * The check page's one interactive piece. Everything pasted stays in this component's state: no
 * request, no storage, no cookie. "Kept on purpose" marks are state too, so they are gone when the
 * tab closes or reloads, and the page says so.
 */
export function CheckTool({
  initial = EMPTY,
  checkOnLoad = false,
}: {
  initial?: CheckInput;
  /** Run the check on `initial` at first render (for the server-rendered test; the page never sets it). */
  checkOnLoad?: boolean;
}) {
  const [input, setInput] = useState<CheckInput>(initial);
  const [run, setRun] = useState<Run | null>(() =>
    checkOnLoad ? { nonce: 1, outcome: runCheck(initial), note: "" } : null,
  );
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ids = {
    grid: useId(),
    gridHelp: useId(),
    privacy: useId(),
    changeover: useId(),
    changeoverHelp: useId(),
    curfew: useId(),
    curfewHelp: useId(),
    pairs: useId(),
    pairsHelp: useId(),
    errors: useId(),
  };

  // After a check that read the grid, the first result heading takes focus.
  useEffect(() => {
    const heading = headingRef.current;
    if (!run?.outcome.ok || !heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start" });
  }, [run]);

  const check = useCallback((next: CheckInput, note = "") => {
    const outcome = runCheck(next);
    setShowAll(false);
    setRun((previous) => ({ nonce: (previous?.nonce ?? 0) + 1, outcome, note }));
  }, []);

  function update(field: keyof CheckInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  function loadSample() {
    const sample: CheckInput = {
      grid: SAMPLE_GRID,
      changeover: SAMPLE_SETTINGS.changeover,
      curfew: SAMPLE_SETTINGS.curfew,
      pairs: SAMPLE_SETTINGS.pairs,
    };
    setInput(sample);
    check(sample, "Sample loaded. ");
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "clash-control-grid-template.csv";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function keep(id: string, mark: boolean) {
    setKept((current) => {
      const next = new Set(current);
      if (mark) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const outcome = run?.outcome;

  return (
    <div>
      <form
        className="print:hidden"
        onSubmit={(event) => {
          event.preventDefault();
          check(input);
        }}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8">
          <div className="min-w-0">
            <label htmlFor={ids.grid} className="type-kicker block">
              Draft grid
            </label>
            <textarea
              id={ids.grid}
              value={input.grid}
              onChange={(event) => update("grid", event.target.value)}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-describedby={`${ids.gridHelp} ${ids.privacy}`}
              placeholder={"act,stage,start,end,locked\nExample act,Main stage,18:00,19:00"}
              rows={12}
              className={`${FIELD} min-h-56 resize-y p-3 font-mono text-sm leading-relaxed`}
            />
            <p id={ids.gridHelp} className="mt-2 text-sm leading-relaxed text-muted-foreground">
              One set per line: act, stage, start, end, and optionally locked. Comma or tab. One day,
              up to {CHECK_LIMITS.sets} sets, {CHECK_LIMITS.stages} stages and 8 KB. Times as H:MM or HH:MM.
              Write after-midnight times as 24:30 or later; a set that ends before 06:00 and before it
              starts is read as ending the next day.
            </p>
            <p
              id={ids.privacy}
              className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted p-3 text-sm leading-relaxed"
            >
              <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                Nothing you paste is sent anywhere, saved to this browser or kept after you close or
                reload this tab. The marks you set below live in this tab’s memory only.
              </span>
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={loadSample}>
                <FileText aria-hidden="true" />
                Load a sample
              </Button>
              <Button type="button" variant="outline" onClick={downloadTemplate}>
                <Download aria-hidden="true" />
                Download a template
              </Button>
            </div>
          </div>

          <div className="min-w-0 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div>
                <label htmlFor={ids.changeover} className="type-kicker block">
                  Changeover (minutes)
                </label>
                <input
                  id={ids.changeover}
                  type="text"
                  inputMode="numeric"
                  value={input.changeover}
                  onChange={(event) => update("changeover", event.target.value)}
                  placeholder={String(CHECK_LIMITS.defaultChangeover)}
                  autoComplete="off"
                  aria-describedby={ids.changeoverHelp}
                  className={`${FIELD} h-11`}
                />
                <p id={ids.changeoverHelp} className="mt-1.5 text-sm text-muted-foreground">
                  The least gap between two sets on a stage. Blank means {CHECK_LIMITS.defaultChangeover}.
                </p>
              </div>
              <div>
                <label htmlFor={ids.curfew} className="type-kicker block">
                  Curfew (latest end)
                </label>
                <input
                  id={ids.curfew}
                  type="text"
                  value={input.curfew}
                  onChange={(event) => update("curfew", event.target.value)}
                  placeholder="none"
                  autoComplete="off"
                  aria-describedby={ids.curfewHelp}
                  className={`${FIELD} h-11`}
                />
                <p id={ids.curfewHelp} className="mt-1.5 text-sm text-muted-foreground">
                  Blank means none. Times before 06:00 read as after midnight, so 00:00 is midnight.
                </p>
              </div>
            </div>
            <div>
              <label htmlFor={ids.pairs} className="type-kicker block">
                Pairs that must never overlap
              </label>
              <textarea
                id={ids.pairs}
                value={input.pairs}
                onChange={(event) => update("pairs", event.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder="Act A | Act B"
                aria-describedby={ids.pairsHelp}
                rows={4}
                className={`${FIELD} min-h-28 resize-y p-3 font-mono text-sm leading-relaxed`}
              />
              <p id={ids.pairsHelp} className="mt-1.5 text-sm text-muted-foreground">
                One pair per line, with the names as written in the grid. A name that matches no set,
                or more than one, is refused.
              </p>
            </div>
            <Button type="submit" size="lg" className="w-full sm:w-auto">
              Check the grid
            </Button>
            {outcome && !outcome.ok ? (
              <div
                id={ids.errors}
                role="alert"
                className="rounded-md border-2 border-destructive bg-card p-4 text-sm leading-relaxed"
              >
                <p className="font-semibold">The grid was not checked.</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 break-words">
                  {outcome.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </form>

      <p role="status" aria-live="polite" className="sr-only">
        {run && outcome?.ok ? `${run.note}${announcement(outcome)}` : ""}
      </p>

      {run && outcome?.ok ? (
        <>
          <p className="mt-8 hidden type-title print:mt-0 print:block print:text-[16pt]">{CHECK_COPY.printTitle}</p>
          <CheckResults
            report={outcome.report}
            kept={kept}
            onKeep={keep}
            showAll={showAll}
            onShowAll={setShowAll}
            nonce={run.nonce}
            headingRef={headingRef}
          />
          <div className="mt-6 print:hidden">
            <Button type="button" variant="ink" size="sm" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              Print
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
