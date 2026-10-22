import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AskedBody, TimingBody } from "@/app/method/evidence";
import MethodPage from "@/app/method/page";
import { WhyThisMatters } from "@/components/clash/why-this-matters";

import {
  COUNTS_PAGES,
  EVIDENCE_CLAIMS,
  EVIDENCE_FIGURES,
  EVIDENCE_ID,
  EVIDENCE_INTRO,
  EVIDENCE_LIMITS,
  EVIDENCE_METHOD,
  EVIDENCE_QUESTIONS,
  EVIDENCE_SOURCE_GROUPS,
  EVIDENCE_SOURCES,
  EVIDENCE_TITLE,
  HOME_EVIDENCE,
  evidenceSource,
  sourceName,
} from "./public-evidence";
import {
  ESTIMATED_LABEL,
  MACHINE_LABEL,
  MACHINE_NOTE,
  MACHINE_STEPS,
  MANUAL_MINUTES,
  MANUAL_SENTENCE,
  PRODUCTION_TIMING,
  TIMING_ID,
  TIMING_PENDING,
  TIMING_TITLE,
  TOOLS_SENTENCE,
  TOOL_LINKS,
  machineTimeLine,
} from "./timing-figures";

/** Visible text of markup: tags dropped, entities read, spacing collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** The markup with every closed `<details>` taken out: what a reader sees with no click. */
const withoutDisclosures = (html: string) => html.replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/g, " ");

/** Words that would turn an analysis of pages into a study of people, or an estimate into a measurement. */
const PEOPLE_WORDS = /\bsurvey|\bpoll(ed|s)?\b|study of people|respondents|we asked (programmers|fans|people)|interviewed/i;
const SPEED_CLAIMS = /saves? \d|times faster|\d+x faster|minutes saved|time saved/i;

const ALL_COPY = [
  HOME_EVIDENCE,
  EVIDENCE_INTRO,
  EVIDENCE_METHOD,
  ...EVIDENCE_LIMITS,
  ...EVIDENCE_CLAIMS.map((claim) => claim.sentence),
  ...EVIDENCE_QUESTIONS.flatMap((q) => [q.question, q.shows, q.helps, q.notHelp]),
  MANUAL_SENTENCE,
  TOOLS_SENTENCE,
  MACHINE_NOTE,
];

describe("the verified claims (round 38, evidence lane)", () => {
  it("prints each of the three claims exactly as verified", () => {
    expect(EVIDENCE_CLAIMS.map((claim) => claim.sentence)).toEqual([
      "In 70 public press articles, fan-post summaries and one artist statement from 17 festivals (2015-2026) that we read, 325 set-time clashes are named, covering 538 distinct pairs of acts at 43 festival-years; they come from 10 of the 12 years (none from 2020-21), and one reader coded 22 of the 70 pages as presenting the acts in at least one named clash as different in genre, style or audience.",
      "In 21 statements by programmers, bookers and festival organisers (2015-2026; 13 festivals plus one booking-side interview) that we read, 10 say they try to avoid or limit clashes and 5 say (or, in Riot Fest's case, joke) that clashes cannot be fully avoided at their scale; 7 name limits other than taste (curfew, production, capacity, radius, sunset), 3 describe using app-favourite or ticketing figures to forecast crowds (one known only second-hand, through a LinkedIn post), and none describes ranking pairs of acts by audience closeness before the times are published.",
      "Of 13 tool pages we read, 9 help attendees spot clashes after times are public and 4 are aimed at organisers (post-publication audience analytics, favourites dashboards, crowd forecasts, a block-schedule overlap flag); none of these pages says it ranks the clashes of a draft grid by audience closeness; pair-level overlap scoring is spelled out only in a vendor blog (Ticket Fairy), while Setline Pro and Flux sell clash or schedule-conflict analytics from attendee data without saying how pairs are scored.",
    ]);
  });

  it("keeps each claim's source count equal to the count it states", () => {
    const [complaints, programmers, tools] = EVIDENCE_CLAIMS;
    expect(new Set(complaints.sourceIds).size).toBe(EVIDENCE_FIGURES.clashPages);
    expect(new Set(programmers.sourceIds).size).toBe(EVIDENCE_FIGURES.statements);
    expect(tools.sourceIds.filter((id) => id.startsWith("K"))).toHaveLength(EVIDENCE_FIGURES.toolPages);
    expect(tools.sourceIds.filter((id) => !id.startsWith("K"))).toHaveLength(EVIDENCE_FIGURES.vendorBlogs);
    expect(EVIDENCE_FIGURES.attendeeTools + EVIDENCE_FIGURES.organiserTools).toBe(EVIDENCE_FIGURES.toolPages);
    expect(EVIDENCE_FIGURES.pagesFetched + EVIDENCE_FIGURES.pagesExcerpt).toBe(EVIDENCE_FIGURES.pagesRead);
  });

  it("has a page, with an https address, for every id a claim or a question cites, and no page nothing cites", () => {
    const cited = new Set([...EVIDENCE_CLAIMS.flatMap((c) => c.sourceIds), ...EVIDENCE_QUESTIONS.flatMap((q) => q.keySources)]);
    for (const id of cited) expect(evidenceSource(id).url, id).toMatch(/^https:\/\//);
    expect(new Set(EVIDENCE_SOURCES.map((s) => s.id))).toEqual(cited);
    expect(() => evidenceSource("Z99")).toThrow();
    expect(sourceName(evidenceSource("G01"))).toBe("The Standard (London), Glastonbury 2025");
    expect(sourceName(evidenceSource("K01"))).toBe("Clashfinder");
  });
});

describe("the home sentence (round 38)", () => {
  it("states the first claim as an analysis of public pages, with what it counts, and links its sources on /method", () => {
    expect(HOME_EVIDENCE).toBe(
      "Our analysis of 70 public press articles, fan-post summaries and one artist statement from 17 festivals (2015 to 2026) found 325 named set-time clashes, covering 538 distinct pairs of acts. It counts pages, not people, so it shows the complaint keeps coming back, not how many people mind.",
    );
    const html = renderToStaticMarkup(createElement(WhyThisMatters));
    const visible = text(withoutDisclosures(html));
    expect(visible).toContain(`${HOME_EVIDENCE} Sources and limits`);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/method#${EVIDENCE_ID}"[^>]*>Sources and limits</a>`));
    // It sits in the problem's column, after the fold that qualifies the 45 verified clashes.
    const at = html.indexOf("<p data-why-public");
    expect(at).toBeGreaterThan(html.indexOf("How the lists lean ("));
    expect(at).toBeLessThan(html.indexOf('data-why-col="unknown"'));
  });

  it("names Setline beside the schedulers, so the absence line is not read as nobody having the idea", () => {
    const plain = text(renderToStaticMarkup(createElement(WhyThisMatters)));
    expect(plain).toContain(
      "We found none that reads audience overlap (our search, October 2026). Setline sells organisers clash analysis from attendee interest once set times are live.",
    );
  });
});

describe("What people ask about clashes on /method (round 38)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const section = html.slice(html.indexOf(`<section id="${EVIDENCE_ID}"`), html.indexOf(`<section id="${TIMING_ID}"`));

  it("is a section of the page with its title, listed in the running order, after the limits and before the timing block", () => {
    expect(section).toContain(`<h2 id="${EVIDENCE_ID}-heading"`);
    expect(text(section)).toContain(EVIDENCE_TITLE);
    expect(html).toMatch(new RegExp(`<a href="#${EVIDENCE_ID}"[^>]*><span[^>]*>${EVIDENCE_TITLE}</span></a>`));
    expect(html.indexOf(`id="${EVIDENCE_ID}"`)).toBeGreaterThan(html.indexOf('id="limits"'));
    expect(html.indexOf(`id="${EVIDENCE_ID}"`)).toBeLessThan(html.indexOf('id="the-rest"'));
  });

  it("shows the intro, the three claims, the method and every limit with no click", () => {
    const visible = text(withoutDisclosures(section));
    expect(EVIDENCE_INTRO).toBe(
      "We read 145 public pages from 2015 to October 2026: press articles, fan-post summaries, interviews with programmers and bookers, tool pages and vendor blogs. Nobody was asked anything. The questions below are the ones those pages raise most, ranked by how many pages touch each. It counts pages, not people, so it shows the complaint keeps coming back, not how many people mind.",
    );
    expect(EVIDENCE_METHOD).toBe(
      "We searched the web by festival, year, clash wording and role (booker, programmer, promoter), then read the hits: 22 pages in full and 123 as search-tool excerpts, so counts from excerpts are lower bounds. Each named clash is logged once per page, and pairs are matched by festival, year and acts. A second pass recounted the figures from the data and re-opened 20 pages.",
    );
    expect(EVIDENCE_LIMITS).toEqual([
      COUNTS_PAGES,
      "The pages lean toward recent years, English-language press and large festivals, so they say nothing about how common clash complaints are across all festivals.",
      "Reddit could not be opened, and some pages, Billboard's among them, could be read only as excerpts.",
      "One reader coded the pages; a second person did not check that coding.",
      "No page we read measures attendance or money lost to a clash.",
    ]);
    for (const line of [EVIDENCE_INTRO, EVIDENCE_METHOD, ...EVIDENCE_LIMITS, ...EVIDENCE_CLAIMS.map((c) => c.sentence)]) {
      expect(visible, line.slice(0, 40)).toContain(text(line));
    }
  });

  it("pins every question and its three answers, most-raised first", () => {
    expect(EVIDENCE_QUESTIONS.map((q) => [q.question, q.pages])).toEqual([
      ["Which of my acts clash, and which clashes are the worst?", 85],
      ["Can I get from one stage to the other in time?", 24],
      ["How do programmers build the timetable?", 22],
      ["Which tools exist, and do organisers have one?", 22],
      ["Do clashes across genres matter, or only clashes within one?", 18],
      ["Why is a big act on a small stage?", 18],
      ["Are clashes put there on purpose to split the crowd?", 16],
      ["When do set times come out, and why so late?", 13],
      ["Can data show whose audiences are close before times are out?", 12],
      ["Do clashes cost the festival anything?", 12],
      ["What limits override fan-friendly timing?", 10],
      ["Do organisers change the timetable after fans complain?", 9],
    ]);
    const pages = EVIDENCE_QUESTIONS.map((q) => q.pages);
    expect([...pages].sort((a, b) => b - a)).toEqual(pages);
    expect(Object.fromEntries(EVIDENCE_QUESTIONS.map((q) => [q.id, [q.shows, q.helps, q.notHelp]]))).toEqual({
      worst: [
        "Worst-clash lists turn up within hours or days of set times going out: 70 pages from 17 festivals name clashes. CultureMap read fan comments on the 2026 Austin City Limits schedule within an hour of it going up.",
        "It ranks the clashes of one day instead of listing every overlap, using minutes shared, Qloo popularity and taste overlap. Check a draft grid lists the sets that share time on a grid you paste.",
        "It cannot say which clashes fans will complain about. In our own test, set before building, taste overlap missed its bar and popularity ranked those clashes higher (see What we tested it against).",
      ],
      walk: [
        "Fans judge a clash by whether they can split it. HuffPost UK says even a 15-minute overlap hurts because of the walk, and Rock am Ring moved a headline set back 15 minutes in 2026 after fans said the gap between two stages was too short.",
        "Each clash shows its minutes shared, moves are checked against the day's gap between sets on a stage, and Try a move says which new overlap a move would create.",
        "It has no walking times or stage distances, so a 15-minute overlap on neighbouring stages looks the same as one at opposite ends of the site.",
      ],
      build: [
        "In the interviews we read, with spreadsheets and judgement. Coachella's Paul Tollett keeps his stages as shaded Excel slots, and Quebec City's programming director writes genres into an eight-stage sheet so one genre is never on two stages the same night.",
        "It starts from what programmers already have, a draft grid. Check a draft grid runs the rule checks in your browser; the app then tests legal moves against the day's rules and prints a one-page brief with a sign-off block.",
        "It knows nothing about fees, riders, radius clauses or soundchecks unless they are typed in as rules. No festival has used it.",
      ],
      tools: [
        "Of 13 tool pages we read, 9 help fans spot clashes after times are public, Clashfinder and Setline's app among them. 4 are for organisers: audience analytics once times are out, a favourites dashboard, crowd forecasts and a block schedule that flags overlaps.",
        "It is for the organiser, before times go out: clashes on a draft grid ranked with a taste signal, then moves and a brief. It is not a planner for fans.",
        "The idea is not unclaimed. A Ticket Fairy blog proposes a conflict-risk score for each pair of acts, and Setline sells clash analysis to organisers. Neither names a customer, and we found nothing showing that a festival pays for either.",
      ],
      genre: [
        "One reader coded 22 of the 70 clash-naming pages as presenting at least one clash as between acts of different genre, style or audience. Tollett said in 2019 that hip-hop, indie and electronic acts could once be set against each other safely, and that fans now cross over.",
        "The Hidden label marks a clash whose acts' main genre tags differ while their taste overlap is in the day's top tenth.",
        "Hidden clashes are examples, not detections. In our test genre tags did worse than taste overlap, and taste overlap still missed its bar.",
      ],
      stage: [
        "The cases cluster at Glastonbury 2024 and Electric Picnic 2026. Emails released under freedom of information show Electric Picnic's organiser warned the council that app figures pointed to one DJ out-drawing the main stage.",
        "Only indirectly: a change of stage is marked as needing production sign-off, and the brief has room for that conversation.",
        "Mostly it does not. It does not forecast how many people want an act and does not read stage capacity, and a taste-overlap rank cannot say an act needs a bigger stage.",
      ],
      planted: [
        "6 pages say or guess so, two features and two blogs among them. None of the 21 organiser and booker statements we read says it of a clash. Osheaga's programmer says he staggers slots so people can catch part of two acts.",
        "A clash can stay: Check a draft grid has a Kept on purpose decision, and the sets this app locks stay put.",
        "It has no model of crowd flow or safety, so it cannot show that a deliberate overlap is safe.",
      ],
      release: [
        "Across 21 festival-years where both dates were in the pages, set times came out a median of 22 days before the first day (3 to 99). We worked these out from article dates, so the festival's own post may have been earlier.",
        "It works on the draft before publication: paste the grid, see the ranked clashes, test moves, then publish.",
        "It does not change when times go out, and nothing shows that a check before publication would cut complaints.",
      ],
      data: [
        "3 of the 21 statements describe using app favourites or ticket figures, to forecast crowds rather than to place clashes; one of them is second-hand. Scoring each pair of acts from streaming or ticket data is proposed in a Ticket Fairy blog, but no organiser in these pages says they do it.",
        "It gives each clashing pair a taste-overlap rank among the acts on one bill, calculated by this app from Qloo data. It needs the act list and the times, and no ticket or app data.",
        "It is a second opinion. The follow-up checks did not establish that taste adds to time and popularity, and acts Qloo has no signal for are left out.",
      ],
      cost: [
        "No page we read measures it. For the best-known case, SZA's thin Pyramid crowd at Glastonbury 2024, the coverage gives several causes, the clashes among them, and no source separates them.",
        "It does not try. Taste overlap is a rank, not attendance, and the Clash Budget Index is a score, not money.",
        "It cannot estimate lost attendance or money, and this app makes no such claim.",
      ],
      limits: [
        "7 of the 21 statements name a limit besides taste: curfew, production, capacity, radius clauses or sunset.",
        "Its rule checks cover each stage's hours, the curfew, the gap between sets on a stage, locked sets and pairs that must never overlap; a change of stage asks for production sign-off.",
        "It does not see contracts, riders or artists' requests unless they are typed in as rules. On the two published days the locks are this app's choice, not the festivals'.",
      ],
      retime: [
        "Sometimes. Rock am Ring moved a headline set back 15 minutes in 2026 after fans said a gap was too short. Laneway deleted and re-posted its 2026 timetable within about an hour, fixing only a typo, according to a columnist.",
        "Try a move and Keep two sets apart list every legal start or swap with its cost, and Keep this move records the choice. Nothing moves until the acts' teams agree.",
        "It cannot speak for artists' teams or production, and its own check of move suggestions missed its bar too (see Moving sets).",
      ],
    });
  });

  it("renders each question as a closed disclosure holding its three answers and three linked pages", () => {
    const body = renderToStaticMarkup(createElement(AskedBody));
    for (const q of EVIDENCE_QUESTIONS) {
      const at = body.indexOf(`${q.question}<span class="cc-disclosure-hint">${q.pages} pages</span>`);
      expect(at, q.id).toBeGreaterThan(-1);
      const fold = body.slice(body.lastIndexOf("<details", at), body.indexOf("</details>", at));
      expect(fold).not.toMatch(/<details[^>]*\sopen/);
      const plain = text(fold);
      expect(plain).toContain(`What the pages show. ${text(q.shows)}`);
      expect(plain).toContain(`How Clash Control helps. ${text(q.helps)}`);
      expect(plain).toContain(`Where it does not. ${text(q.notHelp)}`);
      expect(q.keySources).toHaveLength(3);
      for (const id of q.keySources) {
        const source = evidenceSource(id);
        expect(fold, `${q.id} ${id}`).toContain(
          `<a href="${source.url.replace(/&/g, "&amp;")}" target="_blank" rel="noopener noreferrer"`,
        );
      }
    }
  });

  it("lists every source behind one click, as safe links, grouped by claim", () => {
    const body = renderToStaticMarkup(createElement(AskedBody));
    const at = body.indexOf("Sources for this analysis");
    const fold = body.slice(body.lastIndexOf("<details", at), body.indexOf("</details>", at));
    expect(fold).not.toMatch(/<details[^>]*\sopen/);
    expect(EVIDENCE_SOURCE_GROUPS.map((g) => [g.title, g.ids.length])).toEqual([
      ["Pages that name clashes (70)", 70],
      ["Statements by programmers, bookers and organisers (21)", 21],
      ["Tool pages (13)", 13],
      ["Vendor blogs read beside them (9)", 9],
    ]);
    const links = [...fold.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer"[^>]*>([^<]+)<span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/g)];
    expect(links).toHaveLength(70 + 21 + 13 + 9);
    for (const group of EVIDENCE_SOURCE_GROUPS) {
      for (const id of group.ids) {
        const source = evidenceSource(id);
        expect(links.some(([, href, name]) => href === source.url.replace(/&/g, "&amp;") && text(name) === text(sourceName(source))), id).toBe(true);
      }
    }
  });
});

describe("How long this takes on /method (round 38)", () => {
  const html = renderToStaticMarkup(createElement(MethodPage));
  const start = html.indexOf(`<section id="${TIMING_ID}"`);
  const section = html.slice(start, html.indexOf("</section>", start));

  it("is a section of the page, listed in the running order, before How the rest works", () => {
    expect(start).toBeGreaterThan(-1);
    expect(text(section)).toContain(TIMING_TITLE);
    expect(html).toMatch(new RegExp(`<a href="#${TIMING_ID}"[^>]*><span[^>]*>${TIMING_TITLE}</span></a>`));
    expect(start).toBeLessThan(html.indexOf('id="the-rest"'));
  });

  it("labels the by-hand figures estimated, not measured, and says nobody was timed", () => {
    expect(ESTIMATED_LABEL).toBe("Estimated, not measured");
    expect(MANUAL_SENTENCE).toBe(
      "Estimated, not measured: a Keystroke-Level Model puts the by-hand route at 6 to 22 minutes for Glastonbury 2025 Sunday (39 sets on 5 stages, 79 overlapping pairs), about 12 in a typical case. It assumes an expert who already has the grid in a spreadsheet and makes no mistakes. About two-thirds of it is the model's rough allowance for thinking, so a real person could take more or less time. Nobody was timed.",
    );
    expect(MANUAL_MINUTES.total).toEqual([6.4, 12.3, 22.0]);
    expect(MANUAL_MINUTES.steps.map((s) => s.minutes)).toEqual([
      [3.3, 6.6, 11.3],
      [2.2, 4.4, 8.9],
      [0.3, 0.5, 0.7],
      [0.5, 0.7, 1.1],
    ]);
    const plain = text(section);
    expect(plain).toContain(MANUAL_SENTENCE);
    expect(plain).toContain("All four: 6.4 to 22.0 min, typical 12.3 (estimated)");
    // Every minute figure in the section carries the estimate's label.
    expect(plain.match(/\d+(\.\d)? min, typical/g)).toHaveLength(5);
    expect(plain.match(/\(estimated\)/g)).toHaveLength(5);
  });

  it("says what existing tools' pages say, and links each page", () => {
    expect(TOOLS_SENTENCE).toBe(
      "In the public pages we read, none of these tools gives a time for this job, and none ranks clashing pairs on a draft grid by how close their audiences are. Ticket Fairy and Lineup Ninja already check overlaps and changeovers, and Ticket Fairy checks curfews too. Setline reads attendee interest once times are live. One Ticket Fairy blog calls scheduling a whole lineup by hand “many weeks”, with no figure behind it.",
    );
    expect(text(section)).toContain(TOOLS_SENTENCE);
    expect(TOOL_LINKS.map((t) => t.label)).toEqual([
      "Clashfinder",
      "Festival Pro schedules",
      "Lineup Ninja scheduling",
      "Setline for organisers",
      "Ticket Fairy line-up and running order",
      "Ticket Fairy blog on data-driven scheduling",
    ]);
    for (const tool of TOOL_LINKS) {
      expect(tool.url).toMatch(/^https:\/\//);
      expect(section).toContain(`<a href="${tool.url}" target="_blank" rel="noopener noreferrer"`);
    }
    expect(TOOL_LINKS[5].url).toBe(evidenceSource("V02").url);
  });

  it("prints Clash Control's steps as machine time on production, with no number until the demo driver's figures are in", () => {
    expect(PRODUCTION_TIMING).toBeNull();
    expect(TIMING_PENDING).toBe("measured on production during the final demo recording");
    const plain = text(section);
    expect(MACHINE_STEPS.map((s) => s.step)).toEqual([
      "Load the day",
      "Open the costliest clash",
      "Show the tested move",
      "Keep this move",
      "Print the brief",
    ]);
    for (const { id, step } of MACHINE_STEPS) {
      expect(machineTimeLine(id)).toBe(`${MACHINE_LABEL}: ${TIMING_PENDING}`);
      expect(plain).toContain(`${step}. Machine time on production: measured on production during the final demo recording.`);
    }
    const machine = text(section.slice(section.indexOf(">", section.indexOf("data-timing-machine")) + 1, section.indexOf("<p data-timing-note")));
    expect(machine).not.toMatch(/\d/);
    expect(MACHINE_NOTE).toBe(
      "Machine time is how long the site took to respond, timed by a script. It is not a person's time, and it is never set against the estimate above. Listing pairs and checking rules is arithmetic any tool can do; what Qloo adds is a different way to rank the clashes, not speed.",
    );
    expect(plain).toContain(MACHINE_NOTE);
  });

  it("prints the driver's figures, still labelled machine time, once they are filled in", () => {
    const timing = {
      measured: "23 Oct 2026, build abc1234, median of 10 warm runs",
      steps: { load: "1.2 s", open: "0.1 s", move: "0.1 s", keep: "0.1 s", print: "0.9 s" },
    };
    const plain = text(renderToStaticMarkup(createElement(TimingBody, { timing })));
    expect(plain).toContain("Load the day. Machine time on production: 1.2 s.");
    expect(plain).toContain("Print the brief. Machine time on production: 0.9 s.");
    expect(plain).toContain(timing.measured);
    expect(plain).not.toContain(TIMING_PENDING);
  });
});

describe("the evidence copy's words (round 38)", () => {
  it("never calls the analysis a survey, poll or study of people, and claims no saving of time", () => {
    for (const line of ALL_COPY) {
      expect(line, line.slice(0, 50)).not.toMatch(PEOPLE_WORDS);
      expect(line, line.slice(0, 50)).not.toMatch(SPEED_CLAIMS);
    }
    const method = renderToStaticMarkup(createElement(MethodPage));
    const asked = text(method.slice(method.indexOf(`<section id="${EVIDENCE_ID}"`), method.indexOf('<section id="the-rest"')));
    expect(asked).not.toMatch(PEOPLE_WORDS);
    expect(asked).not.toMatch(SPEED_CLAIMS);
  });

  it("prints no money or attendance figure, and quotes at most one short phrase", () => {
    for (const line of ALL_COPY) {
      expect(line).not.toMatch(/[$£€]\s?\d|\d[\d,]* (people|attendees|fans|tickets)\b|\bGBP\b|\bUSD\b/);
    }
    const quotes = ALL_COPY.join(" ").match(/“[^”]*”|"[^"]*"/g) ?? [];
    expect(quotes).toEqual(["“many weeks”"]);
    for (const quote of quotes) expect(quote.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("keeps clear of the phrasing the house style rules out", () => {
    const joined = ALL_COPY.join(" ");
    expect(joined).not.toMatch(/—|delve|crucial|pivotal|testament|showcas|underscore|landscape|seamless|robust|leverag/i);
  });
});
