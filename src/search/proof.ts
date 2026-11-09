// The proof check: does the company's own announcement name the company and the investors the row
// lists? Pure functions; the read itself happens in advance.ts. A company is proved (at least one
// listed investor is named on the page) or set apart with a reason. Nothing else.
import { QUOTE_MAX_CHARS } from "../core/limits";
import {
  findName,
  matcherFor,
  nameHits,
  nameKey,
  nameWords,
  prepareSentence,
  splitNames,
  startsSentence,
  type NameMatcher,
  type Sentence,
  type SentenceKind,
} from "../core/names";
import { stageOfRound, type Stage } from "../core/stages";
import type { CompanyFacts } from "./facts";

export type SetApartReason =
  | "no_url"
  | "no_date"
  | "before_window"
  | "stage_not_asked"
  | "no_investors_listed"
  | "unreadable"
  | "company_not_named"
  | "no_investor_named"
  | "prize_not_round";

export type CheckedInvestor = {
  name: string;
  key: string;
  role: "lead" | "other";
  named: boolean;
  /** The sentence that names it, cut around the name; null when the page does not name it. */
  quote: string | null;
};

export type ProofResult =
  | {
      status: "proved";
      stage: Stage;
      investors: CheckedInvestor[];
      partner: string | null;
      /** The keys of the leads the partner belongs to. */
      partnerLeads: string[];
      founders: string[];
    }
  | { status: "set_apart"; reason: SetApartReason; investors: CheckedInvestor[] };

/** The investors a row lists, leads first, generic entries dropped, each name once. */
export function listedInvestors(f: CompanyFacts): { name: string; key: string; role: "lead" | "other" }[] {
  const out: { name: string; key: string; role: "lead" | "other" }[] = [];
  const seen = new Set<string>();
  for (const [cell, role] of [[f.leadInvestor, "lead"], [f.otherInvestors, "other"]] as const) {
    for (const name of splitNames(cell)) {
      const key = nameKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, key, role });
    }
  }
  return out;
}

const unnamed = (f: CompanyFacts): CheckedInvestor[] => listedInvestors(f).map((i) => ({ ...i, named: false, quote: null }));

/** The reasons to set a company apart without reading its page, in this order: no link, no date, a
 *  date before the window, a round that is not a stage asked for, no investor listed. */
export function precheck(f: CompanyFacts, window: string, stages: Stage[]): SetApartReason | null {
  if (f.announcementUrl === null) return "no_url";
  if (f.announcedOn === null) return "no_date";
  if (f.announcedOn < window) return "before_window";
  const stage = stageOfRound(f.roundType);
  if (stage === null || !stages.includes(stage)) return "stage_not_asked";
  if (listedInvestors(f).length === 0) return "no_investors_listed";
  return null;
}

// --- Page text to sentences ----------------------------------------------------------------------

/** Words after which a full stop does not end a sentence. */
const ABBREVIATIONS = new Set([
  "inc", "ltd", "llc", "co", "corp", "mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "no", "approx", "est",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "e.g", "i.e", "u.s", "u.k", "u.a.e",
]);

/** One line of markdown as plain text: links keep their words, images, addresses, emphasis and
 *  heading or list marks go. */
function plainLine(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\*+|_{2,}|`+/g, "")
    .replace(/^\s*(?:#{1,6}|>+|[-*+•]|\d+[.)])\s+/, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(block: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?…]+["'”’)\]]*\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/gu;
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    const before = block.slice(start, m.index);
    // The whole last token, so the "M" of "$1.5M" is not taken for an initial.
    const lastWord = (/(\S+)$/u.exec(before)?.[1] ?? "").replace(/^[^\p{L}\p{N}]+/u, "").toLowerCase();
    // "Inc. ", "U.S. " and single initials ("J. ") do not end a sentence.
    if (ABBREVIATIONS.has(lastWord) || /^\p{L}$/u.test(lastWord)) continue;
    out.push(block.slice(start, m.index + m[0].trimEnd().length).trim());
    start = m.index + m[0].length;
  }
  out.push(block.slice(start).trim());
  return out.filter((s) => s !== "");
}

/** A prose line this long that does not end a sentence is wrapped: the next line continues it. */
const WRAPPED_LINE_CHARS = 50;
const BLOCK_START = /^\s*(?:#{1,6}\s|>|[-*+•]\s|\d+[.)]\s|\|)/;

/**
 * The page's sentences, the title first, each prepared once for every name searched in it. A
 * heading, a list item, a table row and a short line (a menu entry) are blocks of their own, so
 * they never run into the next line; a long prose line that stops mid-sentence is joined to the
 * line after it, as pages wrapped at a fixed width need.
 */
export function pageSentences(text: string, title: string | null = null): Sentence[] {
  const blocks: { text: string; kind: SentenceKind }[] = [];
  if (title !== null && plainLine(title) !== "") blocks.push({ text: plainLine(title), kind: "title" });
  let paragraph = "";
  let open = false;
  const flush = () => {
    if (paragraph !== "") blocks.push({ text: paragraph, kind: "text" });
    paragraph = "";
    open = false;
  };
  for (const line of text.split(/\r?\n/)) {
    const plain = plainLine(line);
    if (plain === "" || /^[-=_ ]+$/.test(plain)) {
      flush();
      continue;
    }
    if (BLOCK_START.test(line)) {
      flush();
      blocks.push({ text: plain, kind: /^\s*#{1,6}\s/.test(line) ? "heading" : "text" });
      continue;
    }
    paragraph = open ? `${paragraph} ${plain}` : (flush(), plain);
    open = line.trim().length >= WRAPPED_LINE_CHARS && !/[.!?:"”'’)\]]$/.test(plain);
  }
  flush();
  return blocks.flatMap((b) => splitSentences(b.text).map((t) => prepareSentence(t, b.kind)));
}

/** The page's sentences as text. */
export function sentencesOf(text: string, title: string | null = null): string[] {
  return pageSentences(text, title).map((s) => s.text);
}

// --- Finding names and cutting quotations --------------------------------------------------------

export type Found = { sentence: string; start: number; end: number };

/** Where the page names `name`: the first funding sentence that also names the company, else the
 *  first funding sentence that names it, else the first sentence that names it at all. Null when no
 *  sentence does. A funding word alone can be a firm describing itself ("focused on backing…"). */
export function findInPage(sentences: Sentence[], m: NameMatcher | null, company: NameMatcher | null = null): Found | null {
  if (m === null) return null;
  let funding: Found | null = null;
  let first: Found | null = null;
  for (const sentence of sentences) {
    const hit = findName(sentence, m);
    if (hit === null) continue;
    const found = { sentence: sentence.text, ...hit };
    if (sentence.funding) {
      if (company === null || nameHits(sentence, company).length > 0) return found;
      funding ??= found;
    }
    first ??= found;
  }
  return funding ?? first;
}

/** Times a one-word company name must appear inside a sentence (not as its first word) to count
 *  when no title, heading or funding sentence names it. */
const COMPANY_MID_SENTENCE_HITS = 2;

/**
 * Does the page name the company? A name of two or more words: anywhere, as a whole name. A
 * one-word name is also an ordinary word, but an article about a company names it all through while
 * its funding sentence often says "the company". So it counts, written with its capital letter as a
 * whole word, when it is in the title or a heading, in a funding sentence, or at least twice inside
 * a sentence (not as its first word, where any word has a capital).
 */
export function companyNamed(sentences: Sentence[], m: NameMatcher | null): boolean {
  if (m === null) return false;
  let midSentence = 0;
  for (const sentence of sentences) {
    const hits = nameHits(sentence, m);
    if (hits.length === 0) continue;
    if (!m.oneWord || sentence.kind !== "text" || sentence.funding) return true;
    midSentence += hits.filter((h) => !startsSentence(sentence, h)).length;
    if (midSentence >= COMPANY_MID_SENTENCE_HITS) return true;
  }
  return false;
}

/** Clause ends: a comma, semicolon, colon, dash or bracket, with what follows it. */
const CLAUSE_BREAK = /[,;:()–—]\s*|\s-\s/g;

/**
 * The quotation for a name found at [start, end) in a sentence. A sentence of up to QUOTE_MAX_CHARS
 * is quoted whole. A longer one is cut to the clause that holds the name, widened clause by clause
 * (before it first, where the round is usually named, then after it) while it stays within
 * QUOTE_MAX_CHARS; a clause that is itself
 * too long is cut to the words around the name. "…" marks each side that was cut.
 */
export function cutQuote(sentence: string, start: number, end: number, max: number = QUOTE_MAX_CHARS): string {
  if (sentence.length <= max) return sentence;

  // Clause boundaries: every position a clause may start at, plus both ends of the sentence.
  const cuts = new Set<number>([0, sentence.length]);
  for (let m = CLAUSE_BREAK.exec(sentence); m !== null; m = CLAUSE_BREAK.exec(sentence)) cuts.add(m.index + m[0].length);
  const bounds = [...cuts].sort((a, b) => a - b);
  let a = Math.max(...bounds.filter((x) => x <= start));
  let b = Math.min(...bounds.filter((x) => x >= end && x > a));

  if (b - a > max) {
    // One long clause: the words around the name, the name in the middle where there is room.
    a = Math.max(0, Math.min(start - Math.floor((max - (end - start)) / 2), sentence.length - max));
    b = Math.min(sentence.length, a + max);
    // Whole words only, never cutting into the name.
    if (a > 0) {
      const sp = sentence.indexOf(" ", a - 1);
      if (sp >= 0 && sp < start) a = sp + 1;
    }
    if (b < sentence.length) {
      const sp = sentence.lastIndexOf(" ", b);
      if (sp >= end) b = sp;
    }
  } else {
    for (let grew = true; grew; ) {
      grew = false;
      const prev = [...bounds].reverse().find((x) => x < a);
      if (prev !== undefined && b - prev <= max) {
        a = prev;
        grew = true;
      }
      const next = bounds.find((x) => x > b);
      if (next !== undefined && next - a <= max) {
        b = next;
        grew = true;
      }
    }
  }

  let quote = sentence.slice(a, b).trim();
  if (b < sentence.length) quote = `${quote.replace(/[\s,;:(–—-]+$/, "")}…`;
  if (a > 0) quote = `…${quote.replace(/^[\s,;:)–—-]+/, "")}`;
  return quote;
}

/** The page's quotation for `name`, or null when the page does not name it. */
export function quoteFor(sentences: Sentence[], name: string, company: NameMatcher | null = null): string | null {
  const found = findInPage(sentences, matcherFor(name), company);
  return found === null ? null : cutQuote(found.sentence, found.start, found.end);
}

// --- The check -----------------------------------------------------------------------------------

/**
 * Checks one company against its announcement. `page` is the page's text and title as read, or null
 * when it could not be read. The prechecks come first, so a call with a page for a row that should
 * not have been read still sets it apart for the right reason.
 */
export function checkCompany(
  f: CompanyFacts,
  window: string,
  stages: Stage[],
  page: { text: string; title?: string | null } | null,
): ProofResult {
  const refused = precheck(f, window, stages);
  if (refused !== null) return { status: "set_apart", reason: refused, investors: unnamed(f) };
  if (page === null || page.text.trim() === "") return { status: "set_apart", reason: "unreadable", investors: unnamed(f) };

  const sentences = pageSentences(page.text, page.title ?? null);
  const company = matcherFor(f.name);
  if (!companyNamed(sentences, company)) return { status: "set_apart", reason: "company_not_named", investors: unnamed(f) };

  const found = splitFirms(listedInvestors(f), sentences).map((i) => ({ i, at: findInPage(sentences, matcherFor(i.name), company) }));
  const investors: CheckedInvestor[] = found.map(({ i, at }) => ({
    ...i,
    named: at !== null,
    quote: at === null ? null : cutQuote(at.sentence, at.start, at.end),
  }));
  if (!investors.some((i) => i.named)) return { status: "set_apart", reason: "no_investor_named", investors };
  // Money won in a competition, an award or a grant is not a round, whoever gave it.
  if (found.every(({ at }) => at === null || PRIZE.test(at.sentence.replace(AWARD_WINNING, "")))) {
    return { status: "set_apart", reason: "prize_not_round", investors };
  }

  const partnerMatch = f.leadPartner === null ? null : matcherFor(f.leadPartner);
  const partner = partnerMatch !== null && findInPage(sentences, partnerMatch) !== null ? f.leadPartner : null;
  const founders = splitNames(f.founders).filter((n) => findInPage(sentences, matcherFor(n)) !== null);
  return { status: "proved", stage: stageOfRound(f.roundType)!, investors, partner, partnerLeads: partnerLeads(investors, partnerMatch, sentences), founders };
}

/** Words that make money a prize, not an investment: a competition, an award, a pitch win, a grant. */
const PRIZE = /\b(?:prizes?|competitions?|awards?|awarded|winners?|grants?|hackathons?|pitch (?:competition|contest|battle|night|event|day)s?)\b/i;
/** "an award-winning startup" says nothing about this money. */
const AWARD_WINNING = /\baward[- ]winning\b/gi;

/**
 * A cell entry such as "Caret Capital & Indigram Labs" is two firms when the page names each on its
 * own and never the pair as one name. Each part must be a name of two words or more, so "Wexley & Co"
 * stays whole.
 */
function splitFirms<T extends { name: string; key: string }>(listed: T[], sentences: Sentence[]): T[] {
  const named = (name: string) => findInPage(sentences, matcherFor(name)) !== null;
  return listed.flatMap((i) => {
    const parts = i.name.split(/\s+&\s+/);
    if (parts.length < 2 || named(i.name)) return [i];
    if (!parts.every((p) => nameWords(p).length >= 2 && named(p))) return [i];
    return parts.map((p) => ({ ...i, name: p.trim(), key: nameKey(p) }));
  });
}

/**
 * The leads a partner belongs to. With one lead named, that lead. With two or more, the leads named
 * in a sentence that also names the partner, and none when no sentence gives the partner to one.
 */
function partnerLeads(investors: CheckedInvestor[], partner: NameMatcher | null, sentences: Sentence[]): string[] {
  const leads = investors.filter((i) => i.role === "lead" && i.named);
  if (partner === null || leads.length <= 1) return leads.map((i) => i.key);
  const withPartner = sentences.filter((s) => nameHits(s, partner).length > 0);
  return leads
    .filter((l) => {
      const m = matcherFor(l.name);
      return m !== null && withPartner.some((s) => nameHits(s, m).length > 0);
    })
    .map((l) => l.key);
}
