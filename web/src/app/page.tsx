import { DemoShowcase } from "@/components/showcase/demo-showcase";
import { ProvenanceKey } from "@/components/showcase/provenance-key";

/**
 * Temporary landing page: a showcase for the shared kernel (steps, trace drawer, provenance
 * chips and the honest states). The product name and the value proposition are placeholders.
 */
export default function Home() {
  return (
    <>
      <DemoShowcase
        kicker={<p className="type-kicker text-muted-foreground">Festival timetable optimizer</p>}
        title={
          <h1 className="type-display">
            Clash
            <br />
            Control
          </h1>
        }
        lede={
          <p className="max-w-xl text-xl leading-snug font-medium sm:text-2xl lg:text-xl xl:text-2xl">
            Find the set-time clashes that actually split your crowd, then fix them with{" "}
            <mark className="-mx-1 bg-highlight px-1 text-highlight-foreground [box-decoration-break:clone]">
              real audience-overlap data
            </mark>
            .
          </p>
        }
      />
      <ProvenanceKey />
    </>
  );
}
