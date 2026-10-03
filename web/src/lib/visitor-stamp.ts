/**
 * The visitor stamp: the web proxy signs the address of whoever called it, so the API's per-visitor caps can
 * count the visitor and not the proxy hop in front of it. The API half is `visitor_key` in
 * `backend/app/limits.py`; both sides sign alike (HMAC-SHA256, the secret and the address as UTF-8, lowercase
 * hex). With no secret set the stamp is never made, and the API counts the forwarded address as before.
 */

export const VISITOR_HEADER = "x-clash-visitor";
export const SIGNATURE_HEADER = "x-clash-sig";

const ADDRESS = /^[0-9A-Fa-f:.]{1,64}$/;

/**
 * The caller's address as the hosting layer reports it: the first non-empty hop of `x-forwarded-for`, else
 * `x-real-ip`. Null unless it looks like an IPv4 or IPv6 address (hex digits, colons, dots, at most 64).
 */
export function firstHop(forwardedFor: string | null, realIp: string | null): string | null {
  const hops = (forwardedFor ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const hop = hops.length > 0 ? hops[0] : (realIp ?? "").trim();
  return ADDRESS.test(hop) ? hop : null;
}

/** Lowercase hex HMAC-SHA256 of `visitor`, keyed with `secret` (both as UTF-8). */
export async function stamp(secret: string, visitor: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(visitor));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
