/**
 * "Copy link to this grid": the grid and the settings packed into the link's hash (`/check#g=...`).
 * A hash stays in the browser: it is not part of any request the page makes, so the server never sees
 * the grid. Opening the link fills the fields; nothing is checked until the visitor presses Check.
 * Pure functions, so they are unit tested.
 */

import type { CheckInput } from "@/lib/check";

/** Links longer than this many characters are not offered: some mail and chat tools cut them. */
export const SHARE_LIMIT = 8000;

/** Characters read at most from any one field of a link, so a hostile link cannot fill the page. */
const FIELD_CHARS = 16_384;

const PREFIX = "#g=";

export const SHARE_COPY = {
  button: "Copy share link",
  warning: "Anyone with this link can read the grid.",
  copied: "Link copied. Anyone with this link can read the grid.",
  manual: "Copy the link below. Anyone with this link can read the grid.",
  linkLabel: "Link to this grid",
  tooLong: "This grid is too long for a link. Download it as a .csv instead.",
  filled: "Grid filled from the link. Press Check the grid to run the checks.",
  unreadable: "The link’s grid could not be read, so the fields are as they were.",
  download: "Download CSV",
} as const;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The hash for this grid and its settings: "#g=" and base64url of a small JSON object. */
export function shareHash(input: CheckInput): string {
  const json = JSON.stringify({ v: 1, g: input.grid, c: input.changeover, f: input.curfew, p: input.pairs });
  return `${PREFIX}${toBase64Url(new TextEncoder().encode(json))}`;
}

/** True when the link fits the limit and can be offered. */
export function shareable(link: string): boolean {
  return link.length <= SHARE_LIMIT;
}

/**
 * The fields from a hash, or null when the hash is not one of these links or cannot be read. Unknown
 * keys are ignored; every field must be text.
 */
export function readShareHash(hash: string): CheckInput | null {
  if (!hash.startsWith(PREFIX) || hash.length > SHARE_LIMIT * 2) return null;
  const bytes = fromBase64Url(hash.slice(PREFIX.length));
  if (!bytes) return null;
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const { v, g, c, f, p } = data as Record<string, unknown>;
  if (v !== 1) return null;
  const fields = [g, c, f, p];
  if (!fields.every((field) => typeof field === "string" && field.length <= FIELD_CHARS)) return null;
  return { grid: g as string, changeover: c as string, curfew: f as string, pairs: p as string };
}

/** The working grid's file name. */
export const CSV_NAME = "clash-control-working-grid.csv";

/**
 * The .csv's name for the checked snapshot it holds: the invented sample says so in its name, so a
 * downloaded copy of it is never mistaken for a real draft.
 */
export function csvName(snapshot: { sample: boolean }): string {
  return snapshot.sample ? "clash-control-invented-sample-grid.csv" : CSV_NAME;
}
