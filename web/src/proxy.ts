import { NextResponse, type NextRequest } from "next/server";

import { firstHop, SIGNATURE_HEADER, stamp, VISITOR_HEADER } from "@/lib/visitor-stamp";

/**
 * Signs the caller's address for the API's per-visitor caps (the visitor stamp, see `lib/visitor-stamp.ts`).
 *
 * On the routes below, whatever stamp headers the caller sent are always removed, so a visitor cannot pick the
 * key the caps count them under. When `VISITOR_STAMP_SECRET` is set and the request carries an address, the
 * proxy adds a fresh stamp. With no secret it only removes: the stamp stays inert until the owner sets it.
 *
 * The rule search (`/rule-fixes`) takes a what-if limiter slot when it computes, so it is signed like the plan
 * route. Grid pricing (`/api/price-grid`) takes a slot in its live mode, so it is signed like the pair check. Not matched: the move list (`/moves`, cached at the edge for everyone), the day's `/decision` (cached
 * on the server, no slot) and the preset reads.
 */
export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(VISITOR_HEADER);
  headers.delete(SIGNATURE_HEADER);
  const secret = process.env.VISITOR_STAMP_SECRET;
  if (secret) {
    const visitor = firstHop(headers.get("x-forwarded-for"), headers.get("x-real-ip"));
    if (visitor) {
      headers.set(VISITOR_HEADER, visitor);
      headers.set(SIGNATURE_HEADER, await stamp(secret, visitor));
    }
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/api/pair",
    "/api/price-grid",
    "/api/runs",
    "/api/presets/:id/whatif",
    "/api/presets/:id/rule-fixes",
    "/api/health",
  ],
};
