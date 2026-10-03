/**
 * The notice shown whenever the server is serving its invented day (no preset was built, so there is no
 * Qloo data on the page). Shared by the banner and the sources section so the wording cannot drift.
 */
export const SYNTHETIC_NOTICE = "Synthetic example day: invented acts, no Qloo data";

/** Pages that do not show the day, where the notice would only be noise. */
const QUIET_PATHS = ["/method", "/check"];

export function showsSyntheticNotice(pathname: string | null): boolean {
  if (pathname === null) return true;
  return !QUIET_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
