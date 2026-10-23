/**
 * The public evidence on set-time clashes, from one analysis of public pages read on 22 Oct 2026
 * (`_private/research/2026-10-22/impact/evidence.md` and `evidence.json`, both checked by a second pass the same day).
 *
 * It is an analysis of public pages. Nobody was asked anything, so every count here is a count of pages or of
 * clashes those pages name, never of people. The claim sentences are the verified wording; the figures they
 * use are in `EVIDENCE_FIGURES`, and public-evidence.test.ts pins both. The failed test's own figures are not
 * restated here: /method states them once, and the answers point there. The home page states the first claim
 * in two sentences; /method#asked carries all three, the questions the pages raise, the method, the limits and
 * every source.
 */

import SOURCE_ROWS from "./public-evidence-sources.json";

/** The anchor of the section on /method that holds this analysis. */
export const EVIDENCE_ID = "asked";
/** That section's title. */
export const EVIDENCE_TITLE = "What people ask about clashes";

/** Every figure the analysis prints, as counted in the verified report. */
export const EVIDENCE_FIGURES = {
  /** Pages in the source table, and how they were read. */
  pagesRead: 145,
  pagesFetched: 22,
  pagesExcerpt: 123,
  /** Pages the second pass re-opened. */
  pagesReopened: 20,
  /** Claim 1. */
  clashPages: 70,
  festivals: 17,
  namedClashes: 325,
  pairs: 538,
  festivalYears: 43,
  firstYear: 2015,
  lastYear: 2026,
  yearsWithPages: 10,
  yearsInWindow: 12,
  crossGenrePages: 22,
  /** Claim 2. */
  statements: 21,
  tryToAvoid: 10,
  otherLimits: 7,
  useData: 3,
  /** Claim 3. */
  toolPages: 13,
  attendeeTools: 9,
  organiserTools: 4,
  vendorBlogs: 9,
  /** Set-time release, worked out from article dates. */
  releaseFestivalYears: 21,
  releaseMedianDays: 22,
  releaseRangeDays: [3, 99] as const,
  /** Pages that say or guess that clashes are placed on purpose. */
  plantedPages: 6,
} as const;

const F = EVIDENCE_FIGURES;

/** The three verified claims, word for word, each with the ids of its sources (in `EVIDENCE_SOURCES`). */
export const EVIDENCE_CLAIMS = [
  {
    id: "complaints",
    sentence: `In ${F.clashPages} public press articles, fan-post summaries and one artist statement from ${F.festivals} festivals (${F.firstYear}-${F.lastYear}) that we read, ${F.namedClashes} set-time clashes are named, covering ${F.pairs} pairs of acts when counted separately for each festival and year, at ${F.festivalYears} festival-years; they come from ${F.yearsWithPages} of the ${F.yearsInWindow} years (none from 2020-21), and one reader coded ${F.crossGenrePages} of the ${F.clashPages} pages as presenting the acts in at least one named clash as different in genre, style or audience.`,
    sourceIds: [
      "A07",
      "A06",
      "A01",
      "A03",
      "A02",
      "A04",
      "N01",
      "B01",
      "C07",
      "C05",
      "C09",
      "C11",
      "C08",
      "C10",
      "C06",
      "C13",
      "C15",
      "C02",
      "D01",
      "D02",
      "E01",
      "G19",
      "G20",
      "G17",
      "G10",
      "G12",
      "G13",
      "G16",
      "G09",
      "G11",
      "G14",
      "G27",
      "G28",
      "G08",
      "G01",
      "G03",
      "G04",
      "G34",
      "G06",
      "G07",
      "G33",
      "G05",
      "G36",
      "P02",
      "P03",
      "P04",
      "L05",
      "L07",
      "L08",
      "L01",
      "L09",
      "L04",
      "N02",
      "O01",
      "O02",
      "O03",
      "O04",
      "E03",
      "E04",
      "U01",
      "R04",
      "R03",
      "R02",
      "R01",
      "R05",
      "R06",
      "R07",
      "B02",
      "E05",
      "P01",
    ],
  },
  {
    id: "programmers",
    sentence: `In ${F.statements} public accounts of programming practice that we read, including one second-hand account, ${F.tryToAvoid} describe attempts to avoid or limit clashes or give attendees time to move between stages. None describes ranking pairs of acts by audience closeness before times are published.`,
    sourceIds: [
      "G21",
      "G22",
      "G23",
      "G14",
      "T01",
      "T02",
      "T03",
      "T04",
      "T05",
      "T07",
      "T08",
      "T09",
      "T10",
      "T11",
      "T12",
      "T15",
      "T16",
      "E01",
      "R02",
      "E06",
      "T20",
    ],
  },
  {
    id: "tools",
    sentence: `Of ${F.toolPages} tool pages we read, ${F.attendeeTools} help attendees spot clashes after times are public and ${F.organiserTools} are aimed at organisers (post-publication audience analytics, favourites dashboards, crowd forecasts, a block-schedule overlap flag); none of these pages says it ranks the clashes of a draft grid by audience closeness; pair-level overlap scoring is spelled out only in a vendor blog (Ticket Fairy), while Setline Pro and Flux sell clash or schedule-conflict analytics from attendee data without saying how pairs are scored.`,
    sourceIds: [
      "K01",
      "K02",
      "K03",
      "K04",
      "K05",
      "K06",
      "K07",
      "K08",
      "K09",
      "K10",
      "K11",
      "K12",
      "K13",
      "T18",
      "T19",
      "V01",
      "V02",
      "V03",
      "V04",
      "V05",
      "V06",
      "V07",
    ],
  },
] as const;

/** What the analysis counts: pages, never people. Said wherever a count from it is printed. */
export const COUNTS_PAGES =
  "It counts pages, not people, so it shows the complaint keeps coming back, not how many people mind.";

/** The first claim as the home page says it: one sentence with the counts, then what they count. */
export const HOME_EVIDENCE = `Our analysis of ${F.clashPages} public press articles, fan-post summaries and one artist statement from ${F.festivals} festivals (${F.firstYear} to ${F.lastYear}) found ${F.namedClashes} named set-time clashes, covering ${F.pairs} pairs of acts when counted separately for each festival and year. ${COUNTS_PAGES}`;
/** The home link to the sources, method and limits. */
export const HOME_EVIDENCE_LINK = "Sources and limits";

/** The section's opening paragraph on /method. */
export const EVIDENCE_INTRO = `We read ${F.pagesRead} public pages from ${F.firstYear} to October ${F.lastYear}: press articles, fan-post summaries, interviews with programmers and bookers, tool pages and vendor blogs. Nobody was asked anything. The questions below are the ones those pages raise most, ranked by how many pages touch each. ${COUNTS_PAGES}`;

export type EvidenceQuestion = {
  readonly id: string;
  readonly question: string;
  /** Pages, of the `pagesRead`, that touch the question. */
  readonly pages: number;
  /** What the pages show. */
  readonly shows: string;
  /** How Clash Control helps. */
  readonly helps: string;
  /** Where it does not. */
  readonly notHelp: string;
  /** Three pages that back `shows`, by id in `EVIDENCE_SOURCES`. */
  readonly keySources: readonly string[];
};

/** The questions, most-raised first (a tie keeps the report's order). */
export const EVIDENCE_QUESTIONS: readonly EvidenceQuestion[] = [
  {
    id: "worst",
    question: "Which of my acts clash, and which clashes are the worst?",
    pages: 85,
    shows: `Worst-clash lists turn up within hours or days of set times going out: ${F.clashPages} pages from ${F.festivals} festivals name clashes. CultureMap read fan comments on the 2026 Austin City Limits schedule within an hour of it going up.`,
    helps:
      "It ranks the clashes of one day instead of listing every overlap, using minutes shared, Qloo popularity and taste overlap. Check a draft grid lists the sets that share time on a grid you paste.",
    notHelp:
      "It cannot say which clashes fans will complain about. In our own test, set before building, taste overlap missed its bar and popularity ranked those clashes higher (see What we tested it against).",
    keySources: ["G01", "A04", "G12"],
  },
  {
    id: "walk",
    question: "Can I get from one stage to the other in time?",
    pages: 24,
    shows:
      "Fans judge a clash by whether they can split it. HuffPost UK says even a 15-minute overlap hurts because of the walk, and Rock am Ring moved a headline set back 15 minutes in 2026 after fans said the gap between two stages was too short.",
    helps:
      "Each clash shows its minutes shared, moves are checked against the day's gap between sets on a stage, and Try a move says which new overlap a move would create.",
    notHelp:
      "It has no walking times or stage distances, so a 15-minute overlap on neighbouring stages looks the same as one at opposite ends of the site.",
    keySources: ["G04", "E06", "T05"],
  },
  {
    id: "build",
    question: "How do programmers build the timetable?",
    pages: 22,
    shows:
      "In the interviews we read, with spreadsheets and judgement. Coachella's Paul Tollett keeps his stages as shaded Excel slots, and Quebec City's programming director writes genres into an eight-stage sheet so one genre is never on two stages the same night.",
    helps:
      "It starts from what programmers already have, a draft grid. Check a draft grid runs the rule checks in your browser; the app then tests legal moves against the day's rules and prints a one-page brief with a sign-off block.",
    notHelp:
      "It knows nothing about fees, riders, radius clauses or soundchecks unless they are typed in as rules. No festival has used it.",
    keySources: ["T01", "T07", "T10"],
  },
  {
    id: "tools",
    question: "Which tools exist, and do organisers have one?",
    pages: 22,
    shows: `Of ${F.toolPages} tool pages we read, ${F.attendeeTools} help fans spot clashes after times are public, Clashfinder and Setline's app among them. ${F.organiserTools} are for organisers: audience analytics once times are out, a favourites dashboard, crowd forecasts and a block schedule that flags overlaps.`,
    helps:
      "It is for the organiser, before times go out: clashes on a draft grid ranked with a taste signal, then moves and a brief. It is not a planner for fans.",
    notHelp:
      "The idea is not unclaimed. A Ticket Fairy blog proposes a conflict-risk score for each pair of acts, and Setline sells clash analysis to organisers. Neither names a customer, and we found nothing showing that a festival pays for either.",
    keySources: ["K01", "K03", "V02"],
  },
  {
    id: "genre",
    question: "Do clashes across genres matter, or only clashes within one?",
    pages: 18,
    shows: `One reader coded ${F.crossGenrePages} of the ${F.clashPages} clash-naming pages as presenting at least one clash as between acts of different genre, style or audience. Tollett said in 2019 that hip-hop, indie and electronic acts could once be set against each other safely, and that fans now cross over.`,
    helps:
      "The Hidden label marks a clash whose acts' main genre tags differ while their taste overlap is in the day's top tenth.",
    notHelp:
      "Hidden clashes are examples, not detections. In our test genre tags did worse than taste overlap, and taste overlap still missed its bar.",
    keySources: ["T02", "T20", "P03"],
  },
  {
    id: "stage",
    question: "Why is a big act on a small stage?",
    pages: 18,
    shows:
      "The cases cluster at Glastonbury 2024 and Electric Picnic 2026. Emails released under freedom of information show Electric Picnic's organiser warned the council that app figures pointed to one DJ out-drawing the main stage.",
    helps:
      "Only indirectly: a change of stage is marked as needing production sign-off, and the brief has room for that conversation.",
    notHelp:
      "Mostly it does not. It does not forecast how many people want an act and does not read stage capacity, and a taste-overlap rank cannot say an act needs a bigger stage.",
    keySources: ["E01", "G15", "G30"],
  },
  {
    id: "planted",
    question: "Are clashes put there on purpose to split the crowd?",
    pages: 16,
    shows: `${F.plantedPages} pages say or guess so, two features and two blogs among them. None of the ${F.statements} accounts of programming practice we read says it of a clash. Osheaga's programmer says he staggers slots so people can catch part of two acts.`,
    helps: "A clash can stay: Check a draft grid has a Kept on purpose decision, and the sets this app locks stay put.",
    notHelp: "It has no model of crowd flow or safety, so it cannot show that a deliberate overlap is safe.",
    keySources: ["G06", "G07", "T05"],
  },
  {
    id: "release",
    question: "When do set times come out, and why so late?",
    pages: 13,
    shows: `Across ${F.releaseFestivalYears} festival-years where both dates were in the pages, set times came out a median of ${F.releaseMedianDays} days before the first day (${F.releaseRangeDays[0]} to ${F.releaseRangeDays[1]}). We worked these out from article dates, so the festival's own post may have been earlier.`,
    helps:
      "It works on the draft before publication: paste the grid, see the ranked clashes, test moves, then publish.",
    notHelp:
      "It does not change when times go out, and nothing shows that a check before publication would cut complaints.",
    keySources: ["G12", "D01", "A04"],
  },
  {
    id: "data",
    question: "Can data show whose audiences are close before times are out?",
    pages: 12,
    shows: `${F.useData} of the ${F.statements} accounts describe using app favourites or ticket figures, to forecast crowds rather than to place clashes; one of them is second-hand. Scoring each pair of acts from streaming or ticket data is proposed in a Ticket Fairy blog, but no organiser in these pages says they do it.`,
    helps:
      "It gives each clashing pair a taste-overlap rank among the acts on one bill, calculated by this app from Qloo data. It needs the act list and the times, and no ticket or app data.",
    notHelp:
      "It is a second opinion. The follow-up checks did not establish that taste adds to time and popularity, and acts Qloo has no signal for are left out.",
    keySources: ["T15", "V02", "E01"],
  },
  {
    id: "cost",
    question: "Do clashes cost the festival anything?",
    pages: 12,
    shows:
      "No page we read measures it. For the best-known case, SZA's thin Pyramid crowd at Glastonbury 2024, the coverage gives several causes, the clashes among them, and no source separates them.",
    helps:
      "It does not try. Taste overlap is a rank, not attendance, and the Clash Budget Index is a score, not money.",
    notHelp: "It cannot estimate lost attendance or money, and this app makes no such claim.",
    keySources: ["G28", "G32", "G27"],
  },
  {
    id: "limits",
    question: "What limits override fan-friendly timing?",
    pages: 10,
    shows: `${F.otherLimits} of the ${F.statements} accounts name a limit besides taste: curfew, production, capacity, radius clauses or sunset.`,
    helps:
      "Its rule checks cover each stage's hours, the curfew, the gap between sets on a stage, locked sets and pairs that must never overlap; a change of stage asks for production sign-off.",
    notHelp:
      "It does not see contracts, riders or artists' requests unless they are typed in as rules. On the two published days the locks are this app's choice, not the festivals'.",
    keySources: ["T01", "T08", "O02"],
  },
  {
    id: "retime",
    question: "Do organisers change the timetable after fans complain?",
    pages: 9,
    shows:
      "Sometimes. Rock am Ring moved a headline set back 15 minutes in 2026 after fans said a gap was too short. Laneway deleted and re-posted its 2026 timetable within about an hour, fixing only a typo, according to a columnist.",
    helps:
      "Try a move and Keep two sets apart list every legal start or swap with its cost, and Keep this move records the choice. Nothing moves until the acts' teams agree.",
    notHelp:
      "It cannot speak for artists' teams or production, and its own check of move suggestions missed its bar too (see Moving sets).",
    keySources: ["E06", "P04", "R02"],
  },
];

/** How the pages were found and read. */
export const EVIDENCE_METHOD = `We searched the web by festival, year, clash wording and role (booker, programmer, promoter), then read the hits: ${F.pagesFetched} pages in full and ${F.pagesExcerpt} as search-tool excerpts, so counts from excerpts are lower bounds. Each named clash is logged once per page, and pairs are matched by festival, year and acts. A second pass recounted the figures from the data and re-opened ${F.pagesReopened} pages.`;

/** What the analysis cannot show. */
export const EVIDENCE_LIMITS = [
  COUNTS_PAGES,
  "The pages lean toward recent years, English-language press and large festivals, so they say nothing about how common clash complaints are across all festivals.",
  "Reddit could not be opened, and some pages, Billboard's among them, could be read only as excerpts.",
  "One reader coded the pages; a second person did not check that coding.",
  "No page we read measures attendance or money lost to a clash.",
] as const;

export type EvidenceSource = {
  readonly id: string;
  readonly url: string;
  readonly outlet: string;
  readonly festival: string;
  readonly year: number | null;
  readonly date: string;
};

/**
 * Every page a claim or a question cites, copied from evidence.json (id, address, outlet, festival, year, page date)
 * into public-evidence-sources.json: addresses are data, kept apart from the page copy.
 */
export const EVIDENCE_SOURCES: readonly EvidenceSource[] = SOURCE_ROWS;

const BY_ID = new Map(EVIDENCE_SOURCES.map((source) => [source.id, source]));

/** A source by its id; throws on an id with no page, so a typo cannot ship. */
export function evidenceSource(id: string): EvidenceSource {
  const source = BY_ID.get(id);
  if (!source) throw new Error(`No evidence source ${id}`);
  return source;
}

/** A source's link text: its outlet, then its festival and year where it is about one. */
export function sourceName(source: EvidenceSource): string {
  const about = source.festival && source.festival !== "Multiple" && source.festival !== "n/a" ? source.festival : null;
  const when = source.year ? String(source.year) : null;
  const tail = [about, when].filter(Boolean).join(" ");
  return tail ? `${source.outlet}, ${tail}` : source.outlet;
}

/** The source lists under the section, one per claim; claim 3's tool pages and the blogs read beside them apart. */
export const EVIDENCE_SOURCE_GROUPS: readonly {
  readonly title: string;
  readonly ids: readonly string[];
}[] = [
  {
    title: `Pages that name clashes (${F.clashPages})`,
    ids: EVIDENCE_CLAIMS[0].sourceIds,
  },
  {
    title: `Accounts of programming practice (${F.statements})`,
    ids: EVIDENCE_CLAIMS[1].sourceIds,
  },
  {
    title: `Tool pages (${F.toolPages})`,
    ids: EVIDENCE_CLAIMS[2].sourceIds.filter((id) => id.startsWith("K")),
  },
  {
    title: `Vendor blogs read beside them (${F.vendorBlogs})`,
    ids: EVIDENCE_CLAIMS[2].sourceIds.filter((id) => !id.startsWith("K")),
  },
];
