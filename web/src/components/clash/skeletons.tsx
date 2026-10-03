import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-md bg-muted", className)} />;
}

/** Placeholder for the Clash Budget Index card while a festival day loads. */
export function ScoreSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-5 sm:p-6", className)}>
      <Bone className="h-3 w-36" />
      <div className="mt-4 grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-end gap-x-5">
        <Bone className="aspect-[2/1] w-full rounded-t-full rounded-b-none" />
        <div className="space-y-2 pb-1">
          <Bone className="h-16 w-24" />
          <Bone className="h-3 w-32" />
        </div>
      </div>
      <Bone className="mt-5 h-3 w-full" />
      <Bone className="mt-2 h-3 w-4/5" />
      <Bone className="mt-2 h-3 w-3/5" />
    </div>
  );
}

/** Placeholder for the clash list and timetable. */
export function BoardSkeleton() {
  return (
    <div className="grid gap-10 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="space-y-3">
        <Bone className="h-3 w-48" />
        <Bone className="h-3 w-64" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex gap-3 border-t border-border pt-3">
            <Bone className="h-8 w-8" />
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <div className="grid grid-cols-[52px_repeat(5,minmax(0,1fr))] gap-5 border-b-2 border-border pb-3">
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
                <Bone key={row} className={cn("w-full", (row + column) % 2 ? "h-24" : "h-32")} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 md:hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <Bone key={index} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
