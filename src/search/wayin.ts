// The way in: for the top investors of a search, their own site, an open door on it (a form, or a
// published email address), a cheque size only when the site states one, and, always, the warm
// route through the founders and the partner the announcements named, and a first line for the
// founder's email built from proved facts. The parsing is pure; `lookUpInvestor` does the reads.
import { INVESTOR_REUSE_DAYS, WAY_IN_ATTEMPTS } from "../core/limits";
import { matcherFor, nameHits, nameWords, prepareSentence } from "../core/names";
import { stageInText, type Stage } from "../core/stages";
import type { Env } from "../env";
import { TinyFishError } from "../tinyfish/client";
import { fetchPage } from "../tinyfish/fetch";
import { searchWeb, type SearchHit } from "../tinyfish/search";
import { cutQuote, pageSentences } from "./proof";
import { longDate, monthYear } from "./spec";

// --- Their site ----------------------------------------------------------------------------------

/** Sites that are about investors, not theirs: a search result there is never "their site". */
const NOT_THEIR_SITE =
  /(^|\.)(crunchbase|linkedin|pitchbook|wikipedia|twitter|x|facebook|instagram|youtube|medium|techcrunch|bloomberg|forbes|reuters|cbinsights|tracxn|dealroom|wellfound|angel|signal\.nfx|f6s|golden|zoominfo|owler|craft|glassdoor|github|substack|businesswire|prnewswire|globenewswire|eu-startups|tech|sifted|venturebeat|axios|wsj|ft|nytimes)\.[a-z.]+$/i;

/** The part of a host name that names the organisation: "www.copperline.vc" -> "copperline.vc",
 *  "news.bbc.co.uk" -> "bbc.co.uk". */
export function siteBase(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const labels = host.split(".");
    if (labels.length <= 2) return host;
    const second = labels[labels.length - 2]!;
    const keep = /^(co|com|org|net|ac|gov|edu)$/.test(second) && labels[labels.length - 1]!.length === 2 ? 3 : 2;
    return labels.slice(-keep).join(".");
  } catch {
    return null;
  }
}

/**
 * Their site, from search results: the first result whose title names the investor as a whole
 * name, or whose domain carries the name, on a site that is not a database, a social network or the
 * press. Its home page is the site.
 */
export function pickSite(hits: SearchHit[], name: string): string | null {
  const m = matcherFor(name);
  if (m === null) return null;
  const compact = nameWords(name).join("");
  for (const hit of hits) {
    let u: URL;
    try {
      u = new URL(hit.url);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const base = siteBase(hit.url) ?? "";
    if (NOT_THEIR_SITE.test(base)) continue;
    const label = base.split(".")[0]!.replace(/[^a-z0-9]/g, "");
    const byDomain = compact.length >= 3 && (label.includes(compact) || (label.length >= 4 && compact.startsWith(label)));
    const byTitle = nameHits(prepareSentence(hit.title), m).length > 0;
    if (byDomain || byTitle) return `${u.protocol}//${u.host}/`;
  }
  return null;
}

// --- An open door --------------------------------------------------------------------------------

/** Services founders' pitch forms are made with. A link to one is a form, whatever its address says. */
const FORM_HOSTS = /(^|\.)(typeform\.com|forms\.gle|jotform\.com|tally\.so|airtable\.com|hsforms\.com|paperform\.co|fillout\.com|formstack\.com|cognitoforms\.com)$/i;
/** A door is a page of its own near the top of their site, named for what it is: a path of at most
 *  two parts, one of which says apply, pitch or submit (or contact). An article that mentions
 *  pitching, deep in a blog or a resources section, is not a door. */
const FORM_WORDS = /^(apply|apply-now|application|applications|pitch|pitch-us|pitchus|pitches|submit|submissions?|submit-a-deck|founders-form|deal-?flow|get-funded|funding-application)$/i;
const CONTACT_WORDS = /^(contact|contact-us|contactus|get-in-touch)$/i;
const NOT_A_SECTION = /^(blog|blogs|resources|news|insights|posts|articles?|podcasts?|events|library|learn|stories|perspectives|content)$/i;
const MAX_DOOR_DEPTH = 2;
/** Pages about jobs say "apply" too: never a door for a founder. */
const NOT_A_DOOR = /(career|jobs?|hiring|vacanc|recruit|internship|press|media-kit|privacy|cookie|terms)/i;

export type Door = { url: string; kind: "form" | "contact" };

/**
 * An open door among a page's links: a link on their own site whose address says apply, pitch or
 * submit, or a link to a form service; else a contact page on their own site. Null when there is
 * none.
 */
export function pickDoor(links: string[], siteUrl: string): Door | null {
  const own = siteBase(siteUrl);
  let form: string | null = null;
  let contact: string | null = null;
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link, siteUrl);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const where = `${u.pathname}${u.search}`;
    if (NOT_A_DOOR.test(where)) continue;
    const onSite = siteBase(u.href) === own;
    const parts = u.pathname.split("/").filter((p) => p !== "").map((p) => p.replace(/\.html?$/i, ""));
    const shallow = parts.length <= MAX_DOOR_DEPTH && !parts.some((p) => NOT_A_SECTION.test(p));
    if (form === null && (FORM_HOSTS.test(u.hostname) || (onSite && shallow && parts.some((p) => FORM_WORDS.test(p))))) form = u.href;
    if (contact === null && onSite && shallow && parts.some((p) => CONTACT_WORDS.test(p))) contact = u.href;
  }
  if (form !== null) return { url: form, kind: "form" };
  if (contact !== null) return { url: contact, kind: "contact" };
  return null;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const ONE_EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}$/i;
const NOT_AN_EMAIL =/\.(png|jpe?g|gif|svg|webp|avif)$|@(example|domain|email|sentry|wixpress|sentry-next)\./i;
const GOOD_INBOX = /^(pitch|pitches|deals|dealflow|submit|submissions|apply|founders|hello|hi|info|contact|team|invest|investments)@/i;

/** The best published email address in the texts and links: one on their own site first, an inbox
 *  meant for founders (pitch@, deals@, hello@) before a person's. Null when none is published. */
export function pickEmail(texts: string[], links: string[], siteUrl: string): string | null {
  const own = siteBase(siteUrl);
  const found = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(EMAIL)) found.add(m[0]);
  for (const l of links) if (/^mailto:/i.test(l)) found.add(decodeURIComponent(l.slice(7).split("?")[0] ?? ""));
  const emails = [...found].map((e) => e.toLowerCase()).filter((e) => ONE_EMAIL.test(e) && !NOT_AN_EMAIL.test(e));
  const score = (e: string) => (siteBase(`https://${e.split("@")[1]}`) === own ? 2 : 0) + (GOOD_INBOX.test(e) ? 1 : 0);
  emails.sort((a, b) => score(b) - score(a));
  return emails[0] ?? null;
}

// --- A cheque size -------------------------------------------------------------------------------

const MONEY = /(?:[$€£]\s?\d[\d,.]*\s?(?:k|m|mm|bn|million|thousand)?(?![a-z])|\d[\d,.]*\s?(?:k|m|mm)(?![a-z])|\d[\d,.]*\s?(?:million|thousand)(?:\s(?:dollars|usd|euros|eur|pounds|gbp))?)/i;
const CHEQUE_WORDS = /(?<![a-z])(cheques?|checks?|tickets?|initial investments?|first investments?|investments? of|invests?(?:ing)? (?:up to|between|from))(?![a-z])/i;

/** The sentence where a site states a cheque size in figures, cut around the figure; null when it
 *  states none. A fund's size is not a cheque size: the sentence must speak of a cheque or ticket. */
export function findCheque(text: string): string | null {
  for (const s of pageSentences(text)) {
    if (!CHEQUE_WORDS.test(s.text)) continue;
    const m = MONEY.exec(s.text);
    if (m === null) continue;
    return cutQuote(s.text, m.index, m.index + m[0].length);
  }
  return null;
}

// --- The warm route and the first line -----------------------------------------------------------

export type WarmDeal = {
  company: string;
  led: boolean;
  stage: Stage | null;
  announcedOn: string | null;
  partner: string | null;
  founders: string[];
};

export type WarmPerson = { name: string; role: "founder" | "partner"; company: string };

/** The people who can introduce the founder: the founders of the companies this investor backed,
 *  and the partner who led, where the announcement named them. Each person once. */
export function warmRoute(deals: WarmDeal[]): WarmPerson[] {
  const out: WarmPerson[] = [];
  const seen = new Set<string>();
  for (const d of deals) {
    if (d.led && d.partner !== null && !seen.has(d.partner)) {
      seen.add(d.partner);
      out.push({ name: d.partner, role: "partner", company: d.company });
    }
  }
  for (const d of deals) {
    for (const f of d.founders) {
      if (seen.has(f)) continue;
      seen.add(f);
      out.push({ name: f, role: "founder", company: d.company });
    }
  }
  return out;
}

const roundWords = (stage: Stage) => `${stageInText(stage)} round`;
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** The founder's line inside a sentence: lowercased at its start unless its first word is written
 *  as an acronym ("AI", "B2B"), and without a closing full stop. */
export function lineInSentence(line: string): string {
  const t = line.trim().replace(/[.!\s]+$/, "");
  const first = t.split(/\s/)[0] ?? "";
  return /\p{Lu}.*\p{Lu}|\d/u.test(first) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

/**
 * A first line for the founder's email, from proved facts only, by a fixed template. The deal it
 * names is one the investor led if there is one, else one it joined; the most recent of those.
 * "You led Larder Loop's seed round in June 2026; we are building pantry planning software for
 * school kitchens at the same stage."
 */
export function firstLine(deals: WarmDeal[], line: string, founderStage: Stage): string | null {
  const usable = deals.filter((d): d is WarmDeal & { stage: Stage; announcedOn: string } => d.stage !== null && d.announcedOn !== null);
  if (usable.length === 0) return null;
  usable.sort((a, b) => Number(b.led) - Number(a.led) || b.announcedOn.localeCompare(a.announcedOn));
  const d = usable[0]!;
  const verb = d.led ? "led" : "backed";
  const tail = d.stage === founderStage ? "at the same stage" : `and are raising our ${roundWords(founderStage)}`;
  return `You ${verb} ${possessive(d.company)} ${roundWords(d.stage)} in ${monthYear(d.announcedOn)}; we are building ${lineInSentence(line)} ${tail}.`;
}

// --- The lookup ----------------------------------------------------------------------------------

export type InvestorLookupRow = {
  investor_key: string;
  name: string;
  state: "pending" | "looking" | "done";
  claimed_at: string | null;
  site_url: string | null;
  site_source: "row" | "search" | "none" | null;
  door_kind: "form" | "email" | "none" | "unread" | "no_site" | null;
  door_url: string | null;
  door_email: string | null;
  cheque_quote: string | null;
  cheque_url: string | null;
  read_at: string | null;
  looked_up_at: string | null;
  attempts: number;
};

/** What a lookup stores. */
export type WayIn = Pick<
  InvestorLookupRow,
  "site_url" | "site_source" | "door_kind" | "door_url" | "door_email" | "cheque_quote" | "cheque_url" | "read_at"
>;

/** A failure worth trying again: the read ran out of time, or the service was busy. */
class TryAgain extends Error {}

const passing = (status: number | undefined, code: string) => code === "timeout" || status === 429 || (status !== undefined && status >= 500);

/**
 * Looks up one investor: their site (the row's link, else a search), their home page, and the door
 * page it links to. Throws TryAgain for a failure that may pass.
 */
export async function lookUp(env: Env, name: string, siteHint: string | null, now: Date): Promise<WayIn> {
  let site = siteHint;
  let source: WayIn["site_source"] = siteHint !== null ? "row" : null;
  if (site === null) {
    let hits: SearchHit[];
    try {
      hits = await searchWeb(env, `${name} venture capital`);
    } catch (err) {
      if (err instanceof TinyFishError && !passing(err.status, err.code)) hits = [];
      else throw new TryAgain("search");
    }
    site = pickSite(hits, name);
    source = site === null ? "none" : "search";
  }
  const empty = { door_url: null, door_email: null, cheque_quote: null, cheque_url: null };
  if (site === null) return { site_url: null, site_source: "none", door_kind: "no_site", read_at: null, ...empty };

  const home = await fetchPage(env, site, { links: true });
  if (!home.ok) {
    if (passing(home.status, home.error)) throw new TryAgain("home");
    return { site_url: site, site_source: source, door_kind: "unread", read_at: null, ...empty };
  }
  const readOn = now.toISOString().slice(0, 10);
  const door = pickDoor(home.links, home.finalUrl);
  const texts = [home.text];
  const links = [...home.links];
  let cheque = findCheque(home.text);
  let chequeUrl = cheque !== null ? home.finalUrl : null;
  let doorUrl: string | null = null;
  if (door !== null) {
    doorUrl = door.url;
    const page = await fetchPage(env, door.url, { links: true });
    if (page.ok) {
      doorUrl = page.finalUrl;
      texts.push(page.text);
      links.push(...page.links);
      if (cheque === null) {
        cheque = findCheque(page.text);
        chequeUrl = cheque !== null ? page.finalUrl : null;
      }
    }
  }
  const email = pickEmail(texts, links, home.finalUrl);
  return {
    site_url: home.finalUrl,
    site_source: source,
    door_kind: doorUrl !== null ? "form" : email !== null ? "email" : "none",
    door_url: doorUrl,
    door_email: email,
    cheque_quote: cheque,
    cheque_url: chequeUrl,
    read_at: readOn,
  };
}

const DAY_MS = 86_400_000;

/** The lookups older than this are done again. */
export const reuseBefore = (now: Date) => new Date(now.getTime() - INVESTOR_REUSE_DAYS * DAY_MS).toISOString();

/**
 * Claims one investor's lookup (pending, a claim gone stale, or a lookup older than 30 days), looks
 * it up and stores it under the claim. A passing failure puts it back as pending until
 * WAY_IN_ATTEMPTS is used up; then what is known is stored. False when there was nothing to claim.
 */
export async function lookUpInvestor(env: Env, key: string, siteHint: string | null, now: Date, staleBefore: string): Promise<boolean> {
  const token = `${now.toISOString()}#${crypto.randomUUID()}`;
  const claimed = await env.DB.prepare(
    `UPDATE investors SET state = 'looking', claimed_at = ?1
     WHERE investor_key = ?2
       AND (state = 'pending' OR (state = 'looking' AND claimed_at < ?3) OR (state = 'done' AND looked_up_at < ?4))
     RETURNING *`,
  )
    .bind(token, key, staleBefore, reuseBefore(now))
    .first<InvestorLookupRow>();
  if (claimed === null) return false;

  let found: WayIn;
  try {
    found = await lookUp(env, claimed.name, siteHint, now);
  } catch (err) {
    const again = err instanceof TryAgain || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"));
    if (!again) throw err;
    if (claimed.attempts + 1 < WAY_IN_ATTEMPTS) {
      await env.DB.prepare("UPDATE investors SET state = 'pending', attempts = attempts + 1 WHERE investor_key = ? AND claimed_at = ?").bind(key, token).run();
      return true;
    }
    found = {
      site_url: siteHint,
      site_source: siteHint !== null ? "row" : "none",
      door_kind: siteHint !== null ? "unread" : "no_site",
      door_url: null,
      door_email: null,
      cheque_quote: null,
      cheque_url: null,
      read_at: null,
    };
  }
  await env.DB.prepare(
    `UPDATE investors SET state = 'done', attempts = 0, site_url = ?, site_source = ?, door_kind = ?, door_url = ?, door_email = ?,
       cheque_quote = ?, cheque_url = ?, read_at = ?, looked_up_at = ?
     WHERE investor_key = ? AND claimed_at = ?`,
  )
    .bind(found.site_url, found.site_source, found.door_kind, found.door_url, found.door_email, found.cheque_quote, found.cheque_url, found.read_at, now.toISOString(), key, token)
    .run();
  return true;
}

// --- Words ---------------------------------------------------------------------------------------

/** The door as the page says it. */
export function doorSentence(w: Pick<WayIn, "door_kind" | "door_url" | "door_email" | "read_at">): string {
  switch (w.door_kind) {
    case "form":
      return `Open form: ${w.door_url}`;
    case "email":
      return `Email published: ${w.door_email}`;
    case "none":
      return `No open form found on their site, read ${w.read_at !== null ? longDate(w.read_at) : "today"}.`;
    case "unread":
      return "Their site could not be read.";
    default:
      return "No site of their own was found.";
  }
}

export const NO_CHEQUE = "Cheque size not stated on their site.";
