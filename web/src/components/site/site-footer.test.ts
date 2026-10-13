import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { qlooCredits } from "@/lib/credit";

import {
  FOOTER_INDEPENDENT,
  FOOTER_SOURCES,
  FOOTER_SYNTHETIC,
  LICENSE_URL,
  SOURCE_URL,
  SiteFooter,
} from "./site-footer";
import { SyntheticContext } from "./synthetic-context";

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const footer = (synthetic: boolean) =>
  renderToStaticMarkup(createElement(SyntheticContext.Provider, { value: synthetic }, createElement(SiteFooter, { synthetic })));

describe("the footer's licence, source and independence line (round 31)", () => {
  it("links the MIT licence and the source code, then says the entry is independent, on a published day", () => {
    const html = footer(false);
    const plain = text(html);
    expect(plain).toContain(FOOTER_SOURCES);
    expect(plain).toContain(`MIT licence · Source code · ${FOOTER_INDEPENDENT}`);
    expect(FOOTER_INDEPENDENT).toBe(
      "Independent entry: not endorsed by Qloo, Glastonbury Festival or Riot Fest, and not affiliated with any of them.",
    );
    expect(LICENSE_URL).toBe("https://github.com/neric-joel/qloo-agentic-hackathon/blob/main/LICENSE");
    expect(SOURCE_URL).toBe("https://github.com/neric-joel/qloo-agentic-hackathon");
    expect(html).toMatch(new RegExp(`<a href="${LICENSE_URL}"[^>]*>MIT licence</a>`));
    expect(html).toMatch(new RegExp(`<a href="${SOURCE_URL}"[^>]*>Source code</a>`));
    // After the pinned source credit, never in place of it.
    expect(plain.indexOf("MIT licence")).toBeGreaterThan(plain.indexOf(FOOTER_SOURCES));
  });

  it("keeps the invented day's own footer and adds the same line, which credits no Qloo there", () => {
    const plain = text(footer(true));
    expect(plain).toContain(FOOTER_SYNTHETIC);
    expect(plain).not.toContain("saved Qloo responses");
    expect(plain).toContain(FOOTER_INDEPENDENT);
    expect(qlooCredits(plain)).toEqual([]);
  });

  it("sets the line in the footer's own type: muted 14px on paper, ink links with the 1px control-edge underline, no box", () => {
    const html = footer(false);
    const line = html.match(/<div class="container-page pb-8 text-sm text-muted-foreground"><p data-footer-legal="true"[\s\S]*?<\/p><\/div>/)?.[0] ?? "";
    expect(line).not.toBe("");
    expect(line.match(/<a [^>]*class="[^"]*text-foreground underline decoration-border-strong decoration-1 underline-offset-4/g)).toHaveLength(2);
    expect(line).not.toMatch(/rounded-(md|lg)|shadow|border(?!-strong)|bg-/);
    // The middots are decoration; the links and the sentence carry the meaning.
    expect(line.match(/<span aria-hidden="true"( class="hidden sm:inline")?>·<\/span>/g)).toHaveLength(2);
    // On a phone the sentence starts its own line, with no middot left before it.
    expect(line).toContain('<span aria-hidden="true" class="hidden sm:inline">·</span><span class="basis-full sm:basis-auto">');
  });
});
