/**
 * The decorative illustrations and where they go. Each slot names its files under `public/art/`, its
 * size and its alt text; a component renders a slot only once `enabled` is true, which is flipped
 * by hand when the files are in place, so a missing file never shows as a broken image. None of
 * them is data: they never sit behind or beside a figure, and each sits on its own paper plate
 * (`.art-plate`) so one file serves both themes. Slots 1 to 3 together stay under 120 KB.
 */
export type ArtSlot = {
  /** 1 home hero, 2 `/method` header, 3 `/check` header. */
  slot: 1 | 2 | 3;
  enabled: boolean;
  /** Served paths (files in `public/art/`). */
  avif: string;
  webp: string;
  /** The file's own pixels, so the box is reserved before it loads. */
  width: number;
  height: number;
  /** Empty when the picture is hidden from assistive technology. */
  alt: string;
  /** The `sizes` attribute for the rendered width. */
  sizes: string;
};

export const ART = {
  hero: {
    slot: 1,
    enabled: false,
    avif: "/art/hero-site-plan.avif",
    webp: "/art/hero-site-plan.webp",
    width: 1200,
    height: 896,
    alt: "",
    sizes: "(min-width: 1024px) 560px, 0px",
  },
  method: {
    slot: 2,
    enabled: false,
    avif: "/art/method-sheet.avif",
    webp: "/art/method-sheet.webp",
    width: 2400,
    height: 480,
    alt: "Decorative: a blank gridded sheet, a pencil and a ruler.",
    sizes: "(min-width: 1280px) 1200px, 100vw",
  },
  check: {
    slot: 3,
    enabled: false,
    avif: "/art/check-ruler.avif",
    webp: "/art/check-ruler.webp",
    width: 960,
    height: 640,
    alt: "",
    sizes: "(min-width: 1024px) 480px, 0px",
  },
} as const satisfies Record<string, ArtSlot>;

export type ArtName = keyof typeof ART;

/** The slot when its files are in place, else null (render nothing). */
export function artSlot(name: ArtName): ArtSlot | null {
  const slot: ArtSlot = ART[name];
  return slot.enabled ? slot : null;
}
