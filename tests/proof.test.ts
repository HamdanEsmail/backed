// The proof check on invented announcements. Every company, investor and person is made up.
import { describe, expect, it } from "vitest";
import { findName, matcherFor, splitNames } from "../src/core/names";
import { stageOfRound } from "../src/core/stages";
import { factsOf, type CompanyFacts } from "../src/search/facts";
import { checkCompany, cutQuote, precheck, sentencesOf } from "../src/search/proof";

const WINDOW = "2025-05-01";
const STAGES = ["pre-seed", "seed", "series-a"] as const;

const facts = (over: Record<string, unknown> = {}): CompanyFacts =>
  factsOf({
    company: "Larder Loop",
    country: "United Kingdom",
    round_type: "Seed",
    amount_raised: 4_000_000,
    announcement_date: "2026-06-12",
    lead_investor: "Copperline Ventures",
    other_investors: "Northgate Seed Fund; Ada Fennimore, angel investors",
    lead_partner: "Tobias Quell",
    founders: "Mira Odhiambo, Ravi Castellan",
    announcement_url: "https://news.example/2026/06/larder-loop-seed",
    ...over,
  })!;

const PAGE = `# Larder Loop raises $4M to plan school kitchen pantries

**LONDON, 12 June 2026** – Larder Loop, the pantry planner for school kitchens, today announced a $4M seed round led by [Copperline Ventures](https://copperline.example), with participation from Northgate Seed Fund and the angel investor Ada Fennimore.

"Kitchens throw away less when they plan," said Tobias Quell, partner at Copperline Ventures, who joins the board.

Larder Loop was founded in 2024 by Mira Odhiambo and Ravi Castellan.
`;

describe("checkCompany", () => {
  it("proves a company whose page names it and its investors, with a quotation for each", () => {
    const r = checkCompany(facts(), WINDOW, [...STAGES], { text: PAGE, title: "Larder Loop raises $4M" });
    expect(r.status).toBe("proved");
    if (r.status !== "proved") return;
    expect(r.stage).toBe("seed");
    expect(r.investors.map((i) => [i.name, i.role, i.named])).toEqual([
      ["Copperline Ventures", "lead", true],
      ["Northgate Seed Fund", "other", true],
      ["Ada Fennimore", "other", true],
    ]);
    // The funding sentence is preferred over the quote sentence that also names the lead.
    expect(r.investors[0]!.quote).toContain("led by Copperline Ventures");
    expect(r.investors[0]!.quote).not.toContain("https://");
    expect(r.partner).toBe("Tobias Quell");
    expect(r.founders).toEqual(["Mira Odhiambo", "Ravi Castellan"]);
  });

  it("keeps the partner and founders only when the page names them", () => {
    const r = checkCompany(facts({ lead_partner: "Priya Vantongeren", founders: "Mira Odhiambo, Leo Brandvold" }), WINDOW, [...STAGES], { text: PAGE });
    expect(r.status === "proved" && r.partner).toBe(null);
    expect(r.status === "proved" && r.founders).toEqual(["Mira Odhiambo"]);
  });

  it.each([
    ["no_url", { announcement_url: null }],
    ["no_date", { announcement_date: null }],
    ["no_date", { announcement_date: "June 2026" }],
    ["before_window", { announcement_date: "2025-04-30" }],
    ["stage_not_asked", { round_type: "Series C" }],
    ["stage_not_asked", { round_type: "Series B" }],
    ["stage_not_asked", { round_type: null }],
    ["no_investors_listed", { lead_investor: null, other_investors: "angel investors; others" }],
  ] as const)("sets a company apart without reading: %s", (reason, over) => {
    const f = facts(over as Record<string, unknown>);
    expect(precheck(f, WINDOW, [...STAGES])).toBe(reason);
    expect(checkCompany(f, WINDOW, [...STAGES], { text: PAGE })).toMatchObject({ status: "set_apart", reason });
  });

  it("sets apart a page that could not be read", () => {
    expect(checkCompany(facts(), WINDOW, [...STAGES], null)).toMatchObject({ status: "set_apart", reason: "unreadable" });
    expect(checkCompany(facts(), WINDOW, [...STAGES], { text: "   " })).toMatchObject({ status: "set_apart", reason: "unreadable" });
  });

  it("sets apart a page that names none of the listed investors", () => {
    const text = "Larder Loop raised a seed round led by Brightwater Capital.";
    const r = checkCompany(facts(), WINDOW, [...STAGES], { text });
    expect(r).toMatchObject({ status: "set_apart", reason: "no_investor_named" });
    expect(r.investors.every((i) => !i.named && i.quote === null)).toBe(true);
  });

  it("does not prove a row from a page about a company with a similar name", () => {
    const text = "Larder Loops, a meal kit startup, raised a seed round led by Copperline Ventures.";
    expect(checkCompany(facts(), WINDOW, [...STAGES], { text })).toMatchObject({ status: "set_apart", reason: "company_not_named" });
    const other = "Larder Loop Kitchens? No: Big Larder Looping raised from Copperline Ventures.";
    expect(checkCompany(facts({ company: "Larder Loop Kitchens Group" }), WINDOW, [...STAGES], { text: other }).status).toBe("set_apart");
  });

  it("finds a name whose words the page runs together, and quotes the sentence about the round", () => {
    const text = [
      "Day Harbour Capital is a Lisbon venture firm focused on backing founders in southern Europe.",
      "Larder Loop raised a seed round led by DayHarbour Capital.",
    ].join(" ");
    const r = checkCompany(facts({ lead_investor: "Day Harbour Capital", other_investors: null }), WINDOW, [...STAGES], { text });
    expect(r.status).toBe("proved");
    expect(r.investors[0]!.quote).toBe("Larder Loop raised a seed round led by DayHarbour Capital.");
  });

  it("does not count an investor that is only part of a longer name", () => {
    const text = "Larder Loop raised a seed round led by Copperline Ventures Europe and Northgate Seed Funding Partners.";
    const r = checkCompany(facts(), WINDOW, [...STAGES], { text });
    expect(r.investors.find((i) => i.name === "Copperline Ventures")!.named).toBe(true);
    expect(r.investors.find((i) => i.name === "Northgate Seed Fund")!.named).toBe(false);
  });

  it("does not prove a one-word investor that appears only as an ordinary word, and proves it in a funding sentence", () => {
    const f = facts({ lead_investor: "Beacon", other_investors: null });
    const ordinary = "Larder Loop wants to be a beacon for school kitchens. The beacon of good planning is data. It raised money last week.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text: ordinary })).toMatchObject({ status: "set_apart", reason: "no_investor_named" });
    // Capitalised, but in a sentence about something else.
    const offTopic = "Larder Loop calls its dashboard Beacon. Kitchens like it.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text: offTopic })).toMatchObject({ status: "set_apart", reason: "no_investor_named" });
    // Lowercase in a funding sentence still does not count.
    const lower = "Larder Loop says the beacon round was led by its customers.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text: lower })).toMatchObject({ status: "set_apart", reason: "no_investor_named" });
    const funding = "Larder Loop raised $4M in a round led by Beacon.";
    const r = checkCompany(f, WINDOW, [...STAGES], { text: funding });
    expect(r.status).toBe("proved");
    expect(r.investors[0]!.quote).toBe("Larder Loop raised $4M in a round led by Beacon.");
  });

  it("holds a one-word company name to the same rule", () => {
    const f = facts({ company: "Kettle", lead_investor: "Copperline Ventures", other_investors: null });
    const ordinary = "The kettle is on. Copperline Ventures backed a kitchen startup.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text: ordinary })).toMatchObject({ status: "set_apart", reason: "company_not_named" });
    const named = "Kettle raised a seed round led by Copperline Ventures.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text: named }).status).toBe("proved");
  });

  it("names a one-word company written twice inside sentences, though no funding sentence names it", () => {
    const f = facts({ company: "Kettle", lead_investor: "Copperline Ventures", other_investors: null });
    const text = [
      "Schools now plan meals with Kettle across three counties.",
      "Cooks say Kettle saves an hour a day.",
      "The company raised a seed round led by Copperline Ventures.",
    ].join(" ");
    expect(checkCompany(f, WINDOW, [...STAGES], { text }).status).toBe("proved");
    // Once is not enough.
    const once = "Schools now plan meals with Kettle. The company raised a seed round led by Copperline Ventures.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text: once })).toMatchObject({ status: "set_apart", reason: "company_not_named" });
  });

  it("does not name a one-word company from an ordinary word that only starts sentences", () => {
    const f = facts({ company: "Kettle", lead_investor: "Copperline Ventures", other_investors: null });
    const text = "Kettle sales rose. Kettle prices fell. Kettle makers worry. The company raised a seed round led by Copperline Ventures.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text })).toMatchObject({ status: "set_apart", reason: "company_not_named" });
  });

  it("names a one-word company from the title or a heading", () => {
    const f = facts({ company: "Kettle", lead_investor: "Copperline Ventures", other_investors: null });
    const body = "The company raised a seed round led by Copperline Ventures.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text: `## About Kettle\n\n${body}` }).status).toBe("proved");
    expect(checkCompany(f, WINDOW, [...STAGES], { text: body, title: "Kettle plans school meals" }).status).toBe("proved");
  });

  it("does not take seed in its ordinary sense for a funding word", () => {
    const f = facts({ company: "Larder Loop", lead_investor: "Harvest", other_investors: null });
    const text = "Larder Loop helps farmers plant seed earlier. Harvest comes a month sooner, and the series of trials continues.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text })).toMatchObject({ status: "set_apart", reason: "no_investor_named" });
    const funding = "Larder Loop closed its seed round with Harvest.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text: funding }).status).toBe("proved");
  });

  it("matches names whatever their accents, case or legal suffix", () => {
    const f = facts({ lead_investor: "Ālto Capital, LLC", other_investors: null });
    const text = "Larder Loop's round was led by ALTO CAPITAL with others.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text }).status).toBe("proved");
  });
});

describe("investor cells", () => {
  it("splits mixed separators, drops notes in brackets and generic entries, keeps each name once", () => {
    expect(splitNames("Copperline Ventures (lead), Northgate; Ada Fennimore and others; angel investors")).toEqual([
      "Copperline Ventures",
      "Northgate",
      "Ada Fennimore and others",
    ]);
    expect(splitNames("A group of angel investors; existing investors; Undisclosed investors; Others; Wexley & Co; wexley & co")).toEqual(["Wexley & Co"]);
    expect(splitNames("Fund One, Fund Two, and Fund Three")).toEqual(["Fund One", "Fund Two", "Fund Three"]);
    expect(splitNames(null)).toEqual([]);
  });

  it("drops people named by what they are, and the employers after 'angel investors from'", () => {
    expect(splitNames("Quayle Capital; angel investors from Bramblework, Ostrander, and Pellucid Labs; Fenwick Fund")).toEqual([
      "Quayle Capital",
      "Fenwick Fund",
    ]);
    expect(splitNames("Angel investors; entrepreneurs; operators; early-stage ecosystem participants; executives at Bramblework")).toEqual([]);
    expect(splitNames("Founders Fund; Operator Collective")).toEqual(["Founders Fund", "Operator Collective"]);
  });

  it("reads round types as stages", () => {
    expect(["Pre-Seed", "Seed+", "Seed extension", "Pre-Series A", "Series A", "Series A2", "Series B", "Series C", "Grant"].map(stageOfRound)).toEqual([
      "pre-seed", "seed", "seed", "seed", "series-a", "series-a", "series-b", null, null,
    ]);
  });
});

describe("sentences and quotations", () => {
  it("does not end a sentence after Inc., U.S. or an initial", () => {
    const s = sentencesOf("Copperline Ventures Inc. led the round in the U.S. with J. Fennimore. Then it grew.");
    expect(s).toEqual(["Copperline Ventures Inc. led the round in the U.S. with J. Fennimore.", "Then it grew."]);
    expect(sentencesOf("Our first check is $1.5M. We are patient (Inc. or not).")).toEqual(["Our first check is $1.5M.", "We are patient (Inc. or not)."]);
  });

  it("keeps a heading, a list item and the title apart from the next line", () => {
    expect(sentencesOf("# Funding news\n- Led by Copperline\nLarder Loop grew.", "A title")).toEqual(["A title", "Funding news", "Led by Copperline", "Larder Loop grew."]);
  });

  it("joins a prose sentence wrapped across lines, and keeps short menu lines apart", () => {
    const text = [
      "Home",
      "Funding",
      "Beacon",
      "",
      "London-based Larder Loop has raised $3.5 million in a pre-seed",
      "round led by Copperline Ventures, with participation from Northgate,",
      "Beacon, and Ashgrove. The founders are cooks.",
    ].join("\n");
    expect(sentencesOf(text)).toEqual([
      "Home",
      "Funding",
      "Beacon",
      "London-based Larder Loop has raised $3.5 million in a pre-seed round led by Copperline Ventures, with participation from Northgate, Beacon, and Ashgrove.",
      "The founders are cooks.",
    ]);
    const f = facts({ lead_investor: "Copperline Ventures", other_investors: "Beacon; Ashgrove" });
    const r = checkCompany(f, WINDOW, [...STAGES], { text });
    expect(r.investors.map((i) => i.named)).toEqual([true, true, true]);
  });

  it("names a one-word company from a headline with a raise and a stage", () => {
    const f = facts({ company: "Pelmo", lead_investor: "Copperline Ventures", other_investors: null, round_type: "Pre-seed" });
    const text = "The round was led by Copperline Ventures.";
    expect(checkCompany(f, WINDOW, [...STAGES], { text, title: "Pelmo Raises $1.02M Pre-seed" }).status).toBe("proved");
  });

  it("quotes a short sentence whole", () => {
    const s = "The round was led by Copperline Ventures.";
    expect(cutQuote(s, s.indexOf("Copperline"), s.indexOf(" Ventures") + 9)).toBe(s);
  });

  it("cuts a long sentence to the clauses around the name, marking the cuts", () => {
    const s =
      "Larder Loop, which was founded in 2024 by two former school cooks who wanted to plan pantries better, today announced a seed round of four million dollars, led by Copperline Ventures, with participation from several funds that back education and food businesses across Europe and Africa.";
    const start = s.indexOf("Copperline Ventures");
    const q = cutQuote(s, start, start + "Copperline Ventures".length);
    expect(q).toBe("…today announced a seed round of four million dollars, led by Copperline Ventures…");
  });

  it("cuts one very long clause to whole words around the name", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`);
    words.splice(30, 0, "Copperline", "Ventures");
    const s = words.join(" ");
    const start = s.indexOf("Copperline");
    const q = cutQuote(s, start, start + "Copperline Ventures".length);
    expect(q).toContain("Copperline Ventures");
    expect(q.length).toBeLessThanOrEqual(172);
    expect(q).toMatch(/^…word\d+ /);
    expect(q).toMatch(/ word\d+…$/);
  });

  it("finds a name across punctuation and a curly apostrophe", () => {
    const m = matcherFor("Closed Circle Partners Venture Group")!;
    expect(findName("It was led by Closed Circle Partners’ Venture Group.", m)).not.toBe(null);
  });
});
