/**
 * The public pages the complained-about clashes come from: the unique `source` URLs of the verified pairs in the
 * project's saved complaint set, in order of first appearance. Ten pages (six articles and four forum threads)
 * give the 45 clusters; one page can name several clashes.
 *
 * A plain list, copied from the complaint set in the entry's private backtest folder (not in this repository)
 * by a one-off local script; nothing here is read at build time. `/method` lists them under "Sources for the 45 clashes".
 */
export const PUBLIC_SOURCES: readonly string[] = [
  "https://www.vice.com/en/via/coachella-2026-set-times-just-announced-conflicts-surprises-and-more/",
  "https://www.reddit.com/comments/1sk3vor/",
  "https://www.sfchronicle.com/entertainment/festivals/article/outside-lands-2026-set-times-22367442.php",
  "https://edmidentity.com/2026/08/02/outside-lands-2026-set-times-essential-info/",
  "https://www.reddit.com/comments/1vevkfi/",
  "https://www.reddit.com/comments/1vbhhdi/",
  "https://www.reddit.com/comments/1v8cvd2/",
  "https://www.timeout.com/chicago/news/the-lollapalooza-daily-schedule-with-set-times-is-out-so-you-can-plan-your-itinerary-051526",
  "https://www.nme.com/features/music-features/glastonbury-2025-set-clash-guide-3868475",
  "https://lambgoat.com/news/54213/riot-fest-share-daily-schedules-for-2026-fans-complain/",
];
