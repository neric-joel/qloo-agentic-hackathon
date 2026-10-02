import { PROVENANCE_META, PROVENANCE_ORDER, ProvenanceChip } from "@/components/kernel/provenance-chip";

/** Legend for the four provenance labels, shown once on the page. */
export function ProvenanceKey() {
  return (
    <section aria-labelledby="provenance-key-heading" className="border-t border-border">
      <div className="container-page py-12 sm:py-16">
        <p className="type-kicker text-muted-foreground">Provenance</p>
        <h2 id="provenance-key-heading" className="type-headline mt-3">
          Every value says where it came from
        </h2>
        <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {PROVENANCE_ORDER.map((provenance) => (
            <div key={provenance} className="border-t-2 border-foreground pt-4">
              <dt>
                <ProvenanceChip provenance={provenance} />
              </dt>
              <dd className="mt-3 max-w-xs text-[0.9375rem] leading-relaxed text-muted-foreground">
                {PROVENANCE_META[provenance].description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
