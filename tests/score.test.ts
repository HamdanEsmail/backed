// The score on a small invented set.
import { describe, expect, it } from "vitest";
import { inCountry } from "../src/core/countries";
import { monthsBefore, rank, type RankCompany } from "../src/search/score";

const TODAY = new Date("2026-11-09T12:00:00Z");
const FOUNDER = { stage: "seed" as const, country: "United Kingdom" };

const inv = (name: string, role: "lead" | "other", named = true) => ({ key: name.toLowerCase(), name, role, named });

const COMPANIES: RankCompany[] = [
  {
    id: "c1",
    name: "Larder Loop",
    stage: "seed",
    country: "UK",
    amountUsd: 4_000_000,
    announcedOn: "2026-06-12",
    leadInvestorWebsite: "https://copperline.example",
    investors: [inv("Copperline", "lead"), inv("Northgate", "other"), inv("Quiet Fund", "other", false)],
  },
  {
    id: "c2",
    name: "Shelfcount",
    stage: "series-a",
    country: "Germany",
    amountUsd: 9_000_000,
    announcedOn: "2025-09-01",
    leadInvestorWebsite: null,
    investors: [inv("Northgate", "lead"), inv("Copperline", "other")],
  },
  {
    id: "c3",
    name: "Pantrywise",
    stage: "pre-seed",
    country: "United States",
    amountUsd: null,
    announcedOn: "2026-10-01",
    leadInvestorWebsite: "https://brightwater.example",
    investors: [inv("Brightwater", "lead"), inv("Ashgrove", "lead")],
  },
];

describe("rank", () => {
  const ranked = rank(COMPANIES, FOUNDER, TODAY);

  it("adds the parts: backed 3, led 2, same stage 2 or next 1, country 1, last six months 1", () => {
    const copper = ranked.find((r) => r.key === "copperline")!;
    expect(copper.deals.map((d) => [d.company, d.parts.map((p) => p.part), d.points])).toEqual([
      ["Larder Loop", ["backed", "led", "same_stage", "same_country", "recent"], 9],
      ["Shelfcount", ["backed", "next_stage"], 4],
    ]);
    expect(copper.score).toBe(13);
    const north = ranked.find((r) => r.key === "northgate")!;
    expect(north.deals.map((d) => d.points)).toEqual([7, 6]);
    expect(north.score).toBe(13);
  });

  it("orders by score, then companies, then name (two ties here), and numbers the positions", () => {
    expect(ranked.map((r) => [r.position, r.name, r.score, r.companies])).toEqual([
      [1, "Copperline", 13, 2],
      [2, "Northgate", 13, 2],
      [3, "Ashgrove", 7, 1],
      [4, "Brightwater", 7, 1],
    ]);
  });

  it("never counts an investor the page did not name", () => {
    expect(ranked.some((r) => r.key === "quiet fund")).toBe(false);
  });

  it("gives the rounds they joined and a site only from a round they led alone", () => {
    const copper = ranked.find((r) => r.key === "copperline")!;
    expect(copper).toMatchObject({ stages: ["seed", "series-a"], minRoundUsd: 4_000_000, maxRoundUsd: 9_000_000, led: 1, siteHint: "https://copperline.example" });
    expect(ranked.find((r) => r.key === "brightwater")!.siteHint).toBe(null);
    expect(ranked.find((r) => r.key === "brightwater")!).toMatchObject({ minRoundUsd: null, maxRoundUsd: null });
  });

  it("gives every investor a slug unique in the search", () => {
    const twins = rank(
      [{ ...COMPANIES[0]!, investors: [{ key: "a", name: "Kite & Co", role: "lead", named: true }, { key: "b", name: "Kite Co", role: "other", named: true }] }],
      FOUNDER,
      TODAY,
    );
    expect(twins.map((r) => r.slug).sort()).toEqual(["kite-co", "kite-co-2"]);
  });
});

describe("dates and countries", () => {
  it("counts six calendar months back, at the end of a short month", () => {
    expect(monthsBefore(new Date("2026-11-09T00:00:00Z"), 6)).toBe("2026-05-09");
    expect(monthsBefore(new Date("2026-08-31T00:00:00Z"), 6)).toBe("2026-02-28");
  });

  it("matches the ways rows write a country", () => {
    expect(inCountry("USA", "United States")).toBe(true);
    expect(inCountry("Israel/US", "United States")).toBe(true);
    expect(inCountry("London, United Kingdom", "United Kingdom")).toBe(true);
    expect(inCountry("UAE", "United Arab Emirates")).toBe(true);
    expect(inCountry("Trinidad and Tobago", "Trinidad and Tobago")).toBe(true);
    expect(inCountry("Nigeria", "Niger")).toBe(false);
    expect(inCountry(null, "Kenya")).toBe(false);
  });
});
