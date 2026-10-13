import { cn } from "@/lib/utils";

/** A placeholder: the muted step of the ladder, a capsule like every bar and track, or a 12px tile. */
function Bone({ className, tile = false }: { className?: string; tile?: boolean }) {
  return <span aria-hidden="true" className={cn("block animate-pulse bg-muted", tile ? "rounded-md" : "rounded-bar", className)} />;
}

/** Placeholder for the Clash Budget Index card while a festival day loads: the card's own surface. */
export function ScoreSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-surface-edge bg-card p-6", className)}>
      <Bone className="h-3 w-36" />
      <div className="mt-4 grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-end gap-x-5">
        <Bone tile className="h-9 w-24" />
        <div className="space-y-2 pb-1">
          <Bone className="h-3 w-32" />
          <Bone className="h-3 w-24" />
        </div>
      </div>
      {/* The index's 6px range track. */}
      <Bone className="mt-5 h-1.5 w-full" />
      <Bone className="mt-5 h-3 w-full" />
      <Bone className="mt-2 h-3 w-4/5" />
      <Bone className="mt-2 h-3 w-3/5" />
    </div>
  );
}

/** Placeholder for the clash list and timetable, on the board's 18rem rail. */
export function BoardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-10 xl:grid-cols-[18rem_minmax(0,1fr)]", className)}>
      <div className="space-y-3">
        <Bone className="h-3 w-48" />
        <Bone className="h-3 w-64" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex gap-3 border-t border-border pt-3">
            <Bone tile className="h-8 w-8" />
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <div className="grid grid-cols-[52px_repeat(5,minmax(0,1fr))] gap-5 pb-3">
          <span />
          {Array.from({ length: 5 }, (_, index) => (
            <Bone key={index} className="h-5 w-3/4" />
          ))}
        </div>
        <div className="mt-3 grid h-[40rem] grid-cols-[52px_repeat(5,minmax(0,1fr))] gap-5">
          <span />
          {Array.from({ length: 5 }, (_, column) => (
            <div key={column} className="space-y-6 pt-4">
              {Array.from({ length: 4 }, (_, row) => (
                <Bone key={row} tile className={cn("w-full", (row + column) % 2 ? "h-24" : "h-32")} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <Bone key={index} tile className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Placeholder for the agent panel while the page finds out whether the live agent is on. */
export function AgentSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-surface-edge bg-card p-6", className)}>
      <Bone className="h-4 w-2/3" />
      <Bone className="mt-4 h-3 w-full" />
      <Bone className="mt-2 h-3 w-5/6" />
      <Bone tile className="mt-6 h-9 w-40" />
    </div>
  );
}
