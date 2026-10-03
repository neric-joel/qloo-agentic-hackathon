/**
 * What programmers and promoters have said in public about clashes, as short paraphrases with the
 * page each one comes from. No quotation marks, no claim about demand: these are problem evidence.
 * Each line was checked against its source page before it was written here.
 */

export type PublicVoice = {
  /** "Emily Eavis, Glastonbury". */
  who: string;
  /** A paraphrase of under 25 words. */
  said: string;
  links: readonly { label: string; href: string }[];
};

export const PUBLIC_VOICES: readonly PublicVoice[] = [
  {
    who: "Emily Eavis, Glastonbury",
    said: "The team looks at stage times to cut clashes, and says that with so many stages some are inevitable.",
    links: [
      { label: "BBC, 2017", href: "https://www.bbc.co.uk/news/newsbeat-40367106" },
      { label: "NME, 2019", href: "https://www.nme.com/news/music/emily-eavis-glastonbury-festival-interview-performance-plans-2503403" },
    ],
  },
  {
    who: "Cora Chan, promoter at Clockenflap",
    said: "The team had expected different audiences, and the clash drew criticism.",
    links: [{ label: "AAA Magazine", href: "https://www.alpsinc.kr/aaamagazine/issue-05-eng/02" }],
  },
  {
    who: "Travis Banko, head of programming at Laneway",
    said: "A clash between two acts turned out worse than the team expected.",
    links: [
      {
        label: "triple j, 2026",
        href: "https://www.abc.net.au/triplej/news/laneway-festival-programming-music-legacy-australian-festivals/106273724",
      },
    ],
  },
  {
    who: "Danny Bell, Goldenvoice",
    said: "Builds the Portola lineup in a spreadsheet that holds mock set times.",
    links: [
      {
        label: "Billboard, 2025",
        href: "https://www.billboard.com/music/concerts/portola-2026-danny-bell-interview-san-francisco-dom-dolla-1236069579/",
      },
    ],
  },
];
