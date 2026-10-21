/**
 * Words for overlaps a move starts or lengthens, shared by the hero's side-effect line and Try a move so
 * the two panels say the same thing from one computation.
 */

/** One overlap that grows: the other set's name and the shared minutes before and after the move. */
export type GrowingOverlap = { name: string; before: number; after: number };

/**
 * Up to two growing overlaps, in the order given ("New 15 min overlap with Joy Crookes." or "Lengthens the
 * overlap with X from 10 to 25 min."), then a count of the rest ("1 more overlap gets longer."). None for
 * none.
 */
export function growthClauses(grows: readonly GrowingOverlap[]): string[] {
  const parts = grows
    .slice(0, 2)
    .map((item) =>
      item.before === 0
        ? `New ${item.after} min overlap with ${item.name}.`
        : `Lengthens the overlap with ${item.name} from ${item.before} to ${item.after} min.`,
    );
  const more = grows.length - 2;
  if (more > 0) parts.push(more === 1 ? "1 more overlap gets longer." : `${more} more overlaps get longer.`);
  return parts;
}

/** The text with its first character in lower case, to continue a sentence: "New 15 min" -> "new 15 min". */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
