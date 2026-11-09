// A page a watch found, read as the facts of one company: the same facts a TinySet row gives, so
// the page then goes through the same proof check. Pure functions. Nothing here judges the page:
// when a fact cannot be read plainly it is left out, and the proof check refuses what is missing.
import { nameWords, splitNames, type Sentence } from "../core/names";
import type { CompanyFacts } from "../search/facts";
import { pageSentences } from "../search/proof";

/** One result a Monitor run reported. */
export type WatchResult = { url: string; title: string | null; date: string | null };

/** What a headline says the company did: "Arc raises $2M", "Arc secures seed funding". */
const VERB = /\s+(?:just\s+)?(?:raises|raised|secures|secured|closes|closed|lands|landed|bags|bagged|nets|netted|gets|receives|received|completes|completed|announces|announced|snags|grabs|picks up|scores)\b/i;

/** Words that describe a company before its name: "Food-waste tech firm Arc", "Cairo startup Arc". */
const DESCRIPTOR = new Set([
  "startup", "start-up", "startups", "company", "firm", "platform", "app", "maker", "provider", "developer",
  "fintech", "edtech", "agritech", "agtech", "foodtech", "proptech", "healthtech", "insurtech", "climatetech", "unicorn",
]);

/** A word that may stand in a name: it starts with a capital or a digit ("Arc", "ClearCOGS", "3D"). */
const NAME_WORD = /^[\p{Lu}\p{N}]/u;
/** Words a name never starts with. */
const NOT_A_NAME_START = new Set(["the", "its", "their", "our", "this", "that", "these", "a", "an", "his", "her"]);
/** A name of more words than this is a phrase, not a name. */
const MAX_NAME_WORDS = 6;

/** The headline's part that holds the verb: "Arc raises $2M | News" -> "Arc raises $2M". */
function headline(title: string): string | null {
  const parts = title.split(/\s+[|–—]\s+|\s+-\s+|:\s+/);
  return parts.find((p) => VERB.test(p)) ?? null;
}

/**
 * The company a headline names before its verb, in every form worth trying, longest first: "Food
 * Waste Monitor Orbisk raises" gives "Food Waste Monitor Orbisk", "Waste Monitor Orbisk", ...,
 * "Orbisk". Words before a descriptor ("Cairo AI startup Nanovate") are dropped, and so is any word
 * up to the last one without a capital. Empty when the headline names nobody plainly.
 */
export function namesInHeadline(title: string | null): string[] {
  if (title === null) return [];
  const h = headline(title);
  const m = h === null ? null : VERB.exec(h);
  if (h === null || m === null) return [];
  let words = h.slice(0, m.index).trim().split(/\s+/).filter((w) => w !== "");
  const lastDescriptor = words.map((w) => w.toLowerCase().replace(/[^\p{L}-]/gu, "")).findLastIndex((w) => DESCRIPTOR.has(w));
  if (lastDescriptor >= 0) words = words.slice(lastDescriptor + 1);
  const lastPlain = words.findLastIndex((w) => !NAME_WORD.test(w));
  if (lastPlain >= 0) words = words.slice(lastPlain + 1);
  if (words.length === 0 || words.length > MAX_NAME_WORDS || NOT_A_NAME_START.has(words[0]!.toLowerCase())) return [];
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) out.push(words.slice(i).join(" ").replace(/[’']s$/, "").replace(/[,.:;!?]+$/, ""));
  return out.filter((n) => nameWords(n).length > 0);
}

// --- Investors -----------------------------------------------------------------------------------

/** Where a lead's name ends: a clause that brings in others, a full stop, a bracket. */
const NAMES_END =
  /,\s*(?:with|alongside|and|as well as|which|who|bringing|taking|according)\b|\s+(?:with|alongside|as well as|together with|bringing|to\s+(?:expand|scale|grow|build|help|fund|accelerate|support|launch|hire))\b|\s+and\s+(?:participation|existing|new|other|returning|several|a\s+group)\b|[.;:!?](?:\s|$)|\s+\(|$/i;
const LED_BY = /\b(?:co-)?led\s+by\s+/gi;
const OTHERS_FROM =
  /\b(?:participation\s+(?:from|of|by)|joined\s+by|alongside|investors?\s+(?:including|include|includes|such\s+as|were|are)|with\s+support\s+from|support\s+from|backed\s+by|from\s+investors?\s+(?:including|such\s+as)|as\s+well\s+as)\s+/gi;

/** The names a phrase lists, as a cell: "A, B and C" -> "A; B; C". The phrase goes through the
 *  same split as a TinySet cell first, commas kept, so "angel investors from A, B" drops the
 *  employers after it; then entries that do not read as a name (no capital, "the London fund") are
 *  dropped. */
function namesCell(phrase: string): string | null {
  const names = splitNames(phrase.replace(/,?\s+(?:and|&amp;)\s+/g, ", "))
    .map((p) => p.replace(/^(?:and|as well as)\s+/i, "").replace(/[’']s\s.*$/, "").trim())
    .filter((p) => {
      const words = p.split(/\s+/);
      return NAME_WORD.test(p) && words.length <= MAX_NAME_WORDS && !NOT_A_NAME_START.has(words[0]!.toLowerCase());
    });
  return names.length === 0 ? null : names.join("; ");
}

/** The names after each match of `re` in the sentence, up to where the list ends. */
function namesAfter(sentence: string, re: RegExp): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(sentence); m !== null; m = re.exec(sentence)) {
    const rest = sentence.slice(m.index + m[0].length);
    const end = NAMES_END.exec(rest);
    const cell = namesCell(rest.slice(0, end === null ? rest.length : end.index));
    if (cell !== null) out.push(cell);
  }
  return out;
}

// --- Round, money and date -----------------------------------------------------------------------

const ROUND = /\b(?:pre[- ]?seed|pre[- ]?series[- ]?a|seed|series[- ]?[a-d])\b/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";

/** A US dollar sum in the text ("$2M", "$1.5 million", "$500K"), or null. */
export function dollarsIn(text: string): number | null {
  const m = /(?:US)?\$\s?(\d+(?:[.,]\d+)?)\s*(million|mn|m|billion|bn|b|thousand|k)?\b/i.exec(text);
  if (m === null) return null;
  const n = Number(m[1]!.replace(",", "."));
  const unit = (m[2] ?? "").toLowerCase();
  const times = /^(million|mn|m)$/.test(unit) ? 1e6 : /^(billion|bn|b)$/.test(unit) ? 1e9 : /^(thousand|k)$/.test(unit) ? 1e3 : 1;
  const usd = Math.round(n * times);
  return Number.isFinite(usd) && usd >= 1000 ? usd : null;
}

const iso = (y: number, mo: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, mo, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};

/**
 * A date as a search result or a page writes it, as YYYY-MM-DD: "2026-09-16", "Sep 16, 2026", "16
 * September 2026", "3 hours ago", "2 days ago". Null for anything vaguer ("1 year ago" included)
 * or later than tomorrow.
 */
export function dateIn(text: string | null, now: Date): string | null {
  if (text === null) return null;
  const t = text.toLowerCase();
  let out: string | null = null;
  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  const mdy = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`).exec(t);
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH},?\\s+(\\d{4})\\b`).exec(t);
  const ago = /\b(\d+|an?|one)\s+(minute|hour|day|week)s?\s+ago\b/.exec(t);
  if (isoMatch !== null) out = iso(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  else if (mdy !== null) out = iso(Number(mdy[3]), MONTHS.indexOf(mdy[1]!.slice(0, 3)), Number(mdy[2]));
  else if (dmy !== null) out = iso(Number(dmy[3]), MONTHS.indexOf(dmy[2]!.slice(0, 3)), Number(dmy[1]));
  else if (ago !== null) {
    const n = /^\d+$/.test(ago[1]!) ? Number(ago[1]) : 1;
    const ms = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[ago[2] as "minute" | "hour" | "day" | "week"];
    out = new Date(now.getTime() - n * ms).toISOString().slice(0, 10);
  }
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  return out !== null && out <= tomorrow ? out : null;
}

/** Lines of a page read for its date: a date further down is more often another story's. */
const DATE_LINES = 40;

// --- The facts -----------------------------------------------------------------------------------

/** Sentences after one that names the company that still speak of its round ("The round was led
 *  by…"), when they have a funding word and say "the round", "the company", "it"… */
const FOLLOWING_SENTENCES = 2;
const SAME_ROUND = /\b(?:the\s+(?:round|funding|financing|investment|raise|deal|company|startup|business)|(?:seed|pre-seed|series\s+[a-d])\s+round\s+was|it|its)\b/i;

/**
 * The facts of the company a watch's page announces, or null when the page does not read as one
 * company's round: no name before a verb in the headline, or no funding sentence that names it.
 * The name is the longest form of the headline's subject that a funding sentence in the body names.
 * Investors come only from funding sentences that name the company or follow one closely.
 */
export function factsFromAnnouncement(result: WatchResult, page: { text: string; title?: string | null }, now: Date): CompanyFacts | null {
  const title = page.title ?? result.title;
  const sentences = pageSentences(page.text, null);
  const candidates = [...namesInHeadline(title), ...(page.title && result.title && page.title !== result.title ? namesInHeadline(result.title) : [])];
  const names = (s: Sentence, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(s.folded);

  let name: string | null = null;
  let near: Sentence[] = [];
  for (const candidate of candidates) {
    const at = sentences.flatMap((s, i) => (s.funding && names(s, candidate) ? [i] : []));
    if (at.length === 0) continue;
    name = candidate;
    const keep = new Set<number>();
    for (const i of at) {
      keep.add(i);
      for (let j = i + 1; j <= i + FOLLOWING_SENTENCES && j < sentences.length; j++) {
        if (sentences[j]!.funding && SAME_ROUND.test(sentences[j]!.text)) keep.add(j);
      }
    }
    near = [...keep].sort((a, b) => a - b).map((i) => sentences[i]!);
    break;
  }
  if (name === null) return null;

  const leads = near.flatMap((s) => namesAfter(s.text, LED_BY));
  const others = near.flatMap((s) => namesAfter(s.text, OTHERS_FROM));
  const round = [title ?? "", ...near.map((s) => s.text)].map((t) => ROUND.exec(t)?.[0] ?? null).find((r) => r !== null) ?? null;
  const pageDate = dateIn(page.text.split(/\r?\n/).slice(0, DATE_LINES).join("\n"), now);

  return {
    name,
    website: null,
    country: null,
    description: null,
    roundType: round,
    amountUsd: [title ?? "", ...near.map((s) => s.text)].map(dollarsIn).find((n) => n !== null) ?? null,
    announcedOn: dateIn(result.date, now) ?? pageDate,
    leadInvestor: leads.length === 0 ? null : leads.join("; "),
    leadInvestorWebsite: null,
    otherInvestors: others.length === 0 ? null : others.join("; "),
    leadPartner: null,
    founders: null,
    announcementUrl: result.url,
  };
}
