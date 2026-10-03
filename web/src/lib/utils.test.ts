import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("still resolves ordinary Tailwind conflicts and joins conditionals", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
    expect(cn("p-2", false && "p-3", undefined, ["m-1"], { "font-bold": true })).toBe("p-2 m-1 font-bold");
  });

  it("lets a later type style replace the text defaults of a wrapper", () => {
    expect(cn("text-sm leading-6 font-medium tracking-tight", "type-kicker")).toBe("type-kicker");
    expect(cn("text-base font-semibold", "type-headline mt-2")).toBe("type-headline mt-2");
    expect(cn("font-semibold tracking-wide", "type-title")).toBe("type-title");
  });

  it("keeps the size when a type style that does not set one comes after it", () => {
    expect(cn("text-4xl leading-none", "type-numeral")).toBe("text-4xl leading-none type-numeral");
    expect(cn("type-numeral", "text-4xl leading-none")).toBe("type-numeral text-4xl leading-none");
  });

  it("lets the wordmark style replace line height but not size", () => {
    expect(cn("text-xl leading-tight font-bold", "type-wordmark")).toBe("text-xl type-wordmark");
  });

  it("keeps unrelated classes next to a type style", () => {
    expect(cn("type-kicker", "text-muted-foreground", "mt-2")).toBe(
      "type-kicker text-muted-foreground mt-2",
    );
  });

  it("keeps a background pattern next to a background colour", () => {
    expect(cn("bg-hatch bg-card", "bg-muted")).toBe("bg-hatch bg-muted");
    expect(cn("bg-timegrid", "bg-background")).toBe("bg-timegrid bg-background");
  });
});
