// The way in, on invented investor sites. Every firm, person and address is made up.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  doorSentence,
  findCheque,
  firstLine,
  lineInSentence,
  lookUpInvestor,
  pickDoor,
  pickEmail,
  pickSite,
  warmRoute,
  type InvestorLookupRow,
  type WarmDeal,
} from "../src/search/wayin";
import { fetchMock } from "./helpers/fetch-mock";
import { fakeTinyFish, FETCH_API, type FakeTinyFish } from "./helpers/tinyset";

const SITE = "https://www.copperline.example/";

describe("their site from a search", () => {
  const hits = [
    { url: "https://www.crunchbase.com/organization/copperline-ventures", title: "Copperline Ventures - Crunchbase", snippet: "" },
    { url: "https://www.linkedin.com/company/copperline", title: "Copperline Ventures | LinkedIn", snippet: "" },
    { url: "https://copperline.example/team/ada", title: "Ada Fennimore, partner", snippet: "" },
    { url: "https://other.example/", title: "Something else", snippet: "" },
  ];

  it("takes the first result on a site of their own, by domain or title, and gives its home page", () => {
    expect(pickSite(hits, "Copperline Ventures")).toBe("https://copperline.example/");
    expect(pickSite([{ url: "https://cv.example/about", title: "Copperline Ventures: seed fund", snippet: "" }], "Copperline Ventures")).toBe("https://cv.example/");
  });

  it("finds none when only databases, networks and the press name them", () => {
    expect(pickSite(hits.slice(0, 2), "Copperline Ventures")).toBe(null);
    expect(pickSite([{ url: "https://techcrunch.com/x", title: "Copperline Ventures raises a fund", snippet: "" }], "Copperline Ventures")).toBe(null);
    // Data vendors and startup directories carry the name in their titles too.
    expect(pickSite([{ url: "https://www.preqin.com/data/profile/fund-manager/copperline-ventures/1", title: "Copperline Ventures - Preqin", snippet: "" }], "Copperline Ventures")).toBe(null);
    expect(pickSite([{ url: "https://www.startuplist.africa/investors/copperline", title: "Copperline Ventures | Startup List Africa", snippet: "" }], "Copperline Ventures")).toBe(null);
  });
});

describe("an open door", () => {
  it("takes an apply or pitch link on their own site, or a form service, before a contact page", () => {
    expect(pickDoor([`${SITE}team`, `${SITE}contact`, `${SITE}pitch-us`], SITE)).toEqual({ url: `${SITE}pitch-us`, kind: "form" });
    expect(pickDoor([`${SITE}contact`, "https://copperline.typeform.com/to/abc"], SITE)).toEqual({ url: "https://copperline.typeform.com/to/abc", kind: "form" });
    expect(pickDoor([`${SITE}team`, `${SITE}contact-us`], SITE)).toEqual({ url: `${SITE}contact-us`, kind: "contact" });
  });

  it("never takes a jobs page, or another site's apply page, for a door", () => {
    expect(pickDoor([`${SITE}careers/apply`, `${SITE}jobs/apply-now`, "https://accelerator.example/apply"], SITE)).toBe(null);
  });

  it("never takes an article that mentions pitching for a door", () => {
    expect(pickDoor([`${SITE}resources/master-classes/pitch-ready-how-to-tell-the-story`, `${SITE}blog/how-to-pitch`, `${SITE}news/contact-tracing-startup`], SITE)).toBe(null);
    expect(pickDoor([`${SITE}founders/apply`, `${SITE}apply.html`], SITE)).toEqual({ url: `${SITE}founders/apply`, kind: "form" });
  });

  it("prefers a published inbox on their own site meant for founders", () => {
    const texts = ["Write to ada@copperline.example or pitch@copperline.example. Logo: logo@2x.png. Press: news@agency.example"];
    expect(pickEmail(texts, [], SITE)).toBe("pitch@copperline.example");
    expect(pickEmail([], ["mailto:hello@copperline.example?subject=Hi"], SITE)).toBe("hello@copperline.example");
    expect(pickEmail(["No address here."], [], SITE)).toBe(null);
  });
});

describe("a cheque size", () => {
  it("quotes a sentence that states a cheque in figures", () => {
    expect(findCheque("We invest in pre-seed companies. Our initial check is typically 750k-$1.5M.")).toBe("Our initial check is typically 750k-$1.5M.");
    expect(findCheque("Tickets range from €250,000 to €1 million.")).toBe("Tickets range from €250,000 to €1 million.");
  });

  it("never takes a fund's size or a bare figure for a cheque", () => {
    expect(findCheque("We manage a $200M fund. Check out our portfolio.")).toBe(null);
    expect(findCheque("Our founders raised $40M after us.")).toBe(null);
  });
});

describe("the warm route and the first line", () => {
  const led: WarmDeal = { company: "Larder Loop", led: true, stage: "seed", announcedOn: "2026-06-12", partner: "Tobias Quell", founders: ["Mira Odhiambo"] };
  const joined: WarmDeal = { company: "Shelfcount", led: false, stage: "series-a", announcedOn: "2026-09-01", partner: null, founders: ["Leo Brandvold", "Mira Odhiambo"] };

  it("names the partner who led, then each founder once, with their company", () => {
    expect(warmRoute([joined, led])).toEqual([
      { name: "Tobias Quell", role: "partner", company: "Larder Loop" },
      { name: "Leo Brandvold", role: "founder", company: "Shelfcount" },
      { name: "Mira Odhiambo", role: "founder", company: "Shelfcount" },
    ]);
  });

  it("writes the first line from a led deal before a more recent joined one", () => {
    expect(firstLine([joined, led], "Pantry planning software for school kitchens.", "seed")).toBe(
      "You led Larder Loop's seed round in June 2026; we are building pantry planning software for school kitchens at the same stage.",
    );
  });

  it("writes the first line from a joined deal, at another stage", () => {
    expect(firstLine([joined], "Pantry planning software for school kitchens", "pre-seed")).toBe(
      "You backed Shelfcount's Series A round in September 2026; we are building pantry planning software for school kitchens and are raising our pre-seed round.",
    );
    expect(firstLine([{ ...joined, company: "Bytes" }], "AI tutor for Arabic", "series-a")).toBe(
      "You backed Bytes' Series A round in September 2026; we are building AI tutor for Arabic at the same stage.",
    );
  });

  it("keeps an acronym at the start of the line", () => {
    expect(lineInSentence("AI tutor in Arabic.")).toBe("AI tutor in Arabic");
    expect(lineInSentence("B2B ordering for cafés")).toBe("B2B ordering for cafés");
    expect(lineInSentence("Cold storage for farmers")).toBe("cold storage for farmers");
  });
});

// --- Lookups against a fake TinyFish -------------------------------------------------------------

const NOW = new Date("2026-11-09T10:00:00.000Z");
const STALE = new Date(NOW.getTime() - 120_000).toISOString();

async function addInvestor(key: string, name: string) {
  await env.DB.prepare("INSERT INTO investors (investor_key, name, state) VALUES (?, ?, 'pending')").bind(key, name).run();
}
const lookup = (key: string) => env.DB.prepare("SELECT * FROM investors WHERE investor_key = ?").bind(key).first<InvestorLookupRow>();

let tf: FakeTinyFish;
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM investors"), env.DB.prepare("DELETE FROM spend")]);
  fetchMock.activate();
  tf = fakeTinyFish();
});
afterEach(() => fetchMock.reset());

describe("looking up an investor", () => {
  it("reads the site the row gives, follows its apply link, and keeps a cheque the door page states", async () => {
    await addInvestor("copperline ventures", "Copperline Ventures");
    tf.pages[SITE] = "# Copperline Ventures\n\nWe back school and food software.";
    tf.links[SITE] = [`${SITE}team`, `${SITE}apply`];
    tf.pages[`${SITE}apply`] = "Apply here. Our first checks are $250k to $1M.";
    expect(await lookUpInvestor(env, "copperline ventures", SITE, NOW, STALE)).toBe(true);
    const row = (await lookup("copperline ventures"))!;
    expect(row).toMatchObject({
      state: "done",
      site_url: SITE,
      site_source: "row",
      door_kind: "form",
      door_url: `${SITE}apply`,
      cheque_quote: "Our first checks are $250k to $1M.",
      cheque_url: `${SITE}apply`,
      read_at: "2026-11-09",
    });
    expect(doorSentence(row)).toBe(`Open form: ${SITE}apply`);
    expect(tf.queries).toEqual([]);
  });

  it("finds an email when the site has no form", async () => {
    await addInvestor("northgate", "Northgate");
    tf.pages["https://northgate.example/"] = "Founders: write to deals@northgate.example with your deck.";
    await lookUpInvestor(env, "northgate", "https://northgate.example/", NOW, STALE);
    const row = (await lookup("northgate"))!;
    expect(row).toMatchObject({ door_kind: "email", door_email: "deals@northgate.example", door_url: null, cheque_quote: null });
    expect(doorSentence(row)).toBe("Email published: deals@northgate.example");
  });

  it("says when the site has neither, with the day it was read", async () => {
    await addInvestor("ashgrove", "Ashgrove");
    tf.pages["https://ashgrove.example/"] = "We back technical founders. Meet our team.";
    tf.links["https://ashgrove.example/"] = ["https://ashgrove.example/team", "https://ashgrove.example/careers/apply"];
    await lookUpInvestor(env, "ashgrove", "https://ashgrove.example/", NOW, STALE);
    const row = (await lookup("ashgrove"))!;
    expect(row.door_kind).toBe("none");
    expect(doorSentence(row)).toBe("No open form found on their site, read 9 November 2026.");
  });

  it("finds the site by a search when the row gives none, and marks it so", async () => {
    await addInvestor("brightwater capital", "Brightwater Capital");
    tf.results["Brightwater Capital venture capital"] = [
      { url: "https://www.crunchbase.com/organization/brightwater", title: "Brightwater Capital - Crunchbase" },
      { url: "https://brightwater.example/about", title: "About Brightwater Capital" },
    ];
    tf.pages["https://brightwater.example/"] = "Pitch us at hello@brightwater.example.";
    await lookUpInvestor(env, "brightwater capital", null, NOW, STALE);
    expect(await lookup("brightwater capital")).toMatchObject({ site_url: "https://brightwater.example/", site_source: "search", door_kind: "email" });
    expect(tf.queries).toEqual(["Brightwater Capital venture capital"]);
  });

  it("says so when no site is found", async () => {
    await addInvestor("ada fennimore", "Ada Fennimore");
    await lookUpInvestor(env, "ada fennimore", null, NOW, STALE);
    const row = (await lookup("ada fennimore"))!;
    expect(row).toMatchObject({ site_url: null, site_source: "none", door_kind: "no_site", read_at: null });
    expect(doorSentence(row)).toBe("No site of their own was found.");
  });

  it("tries a busy site again, then stores it as unread", async () => {
    fetchMock.reset();
    fetchMock.activate();
    fetchMock.intercept({ method: "POST", url: FETCH_API, times: Infinity, reply: { status: 503, json: { error: { code: "SERVICE_BUSY" } } } });
    await addInvestor("kite", "Kite");
    for (let i = 0; i < 2; i++) {
      await lookUpInvestor(env, "kite", "https://kite.example/", NOW, STALE);
      expect(await lookup("kite")).toMatchObject({ state: "pending", attempts: i + 1 });
    }
    await lookUpInvestor(env, "kite", "https://kite.example/", NOW, STALE);
    expect(await lookup("kite")).toMatchObject({ state: "done", door_kind: "unread", attempts: 0 });
  });

  it("reuses a lookup for 30 days, then does it again", async () => {
    await addInvestor("northgate", "Northgate");
    tf.pages["https://northgate.example/"] = "Write to deals@northgate.example.";
    await lookUpInvestor(env, "northgate", "https://northgate.example/", NOW, STALE);
    expect(await lookUpInvestor(env, "northgate", "https://northgate.example/", new Date(NOW.getTime() + 29 * 86_400_000), STALE)).toBe(false);
    const later = new Date(NOW.getTime() + 31 * 86_400_000);
    expect(await lookUpInvestor(env, "northgate", "https://northgate.example/", later, new Date(later.getTime() - 120_000).toISOString())).toBe(true);
    expect(tf.reads["https://northgate.example/"]).toBe(2);
  });
});
