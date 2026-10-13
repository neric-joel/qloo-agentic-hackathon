import { useId, type ReactNode } from "react";
import { CircleSlash } from "lucide-react";
import { cn } from "@/lib/utils";

type AbstainStateProps = {
  title?: string;
  /** Why there is no answer. */
  reason: string;
  /** Specific gaps, e.g. which inputs had no data. */
  details?: readonly string[];
  /** A next step, such as a button to change the input. */
  children?: ReactNode;
  className?: string;
};

/**
 * The honest "no answer": Qloo does not have enough data, so nothing is guessed. Styled as a
 * first-class result rather than an error, because declining is correct behaviour here.
 */
export function AbstainState({
  title = "Not enough Qloo data to say",
  reason,
  details,
  children,
  className,
}: AbstainStateProps) {
  const headingId = useId();
  return (
    <section
      role="status"
      aria-labelledby={headingId}
      className={cn("rounded-lg border border-dotted border-border-strong bg-card p-5", className)}
    >
      <p className="flex items-center gap-1.5 text-[0.8125rem] leading-5 font-semibold text-muted-foreground">
        <CircleSlash aria-hidden="true" className="size-4" />
        No answer
      </p>
      <h3 id={headingId} className="type-title mt-2">
        {title}
      </h3>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{reason}</p>
      {details && details.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {details.map((detail, index) => (
            <li key={`${index}-${detail}`} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground" />
              <span>{detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-4 text-sm font-medium">Nothing was filled in with a guess.</p>
      {children ? <div className="mt-4 flex flex-wrap gap-2">{children}</div> : null}
    </section>
  );
}
