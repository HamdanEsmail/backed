// The proof check: does the company's own announcement name the company and the investors the row
// lists? Pure functions; the read itself happens in advance.ts. A company is proved (at least one
// listed investor is named on the page) or set apart with a reason. Nothing else.
import { QUOTE_MAX_CHARS } from "../core/limits";
import { findName, hasFundingWord, matcherFor, splitNames, nameKey } from "../core/names";
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
  | "no_investor_named";

export type CheckedInvestor = {
  name: string;
  key: string;
  role: "lead" | "other";
  named: boolean;
  /** The sentence that names it, cut around the name; null when the page does not name it. */
  quote: string | null;
};

export type ProofResult =
  | { status: "proved"; stage: Stage; investors: CheckedInvestor[]; partner: string | null; founders: string[] }
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
    const lastWord = (/([\p{L}.]+)$/u.exec(before)?.[1] ?? "").toLowerCase();
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
 * The page's sentences, the title first. A heading, a list item, a table row and a short line
 * (a menu entry) are blocks of their own, so they never run into the next line; a long prose line
 * that stops mid-sentence is joined to the line after it, as pages wrapped at a fixed width need.
 */
export function sentencesOf(text: string, title: string | null = null): string[] {
  const blocks: string[] = [];
  if (title !== null && plainLine(title) !== "") blocks.push(plainLine(title));
  let paragraph = "";
  let open = false;
  const flush = () => {
    if (paragraph !== "") blocks.push(paragraph);
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
      blocks.push(plain);
      continue;
    }
    paragraph = open ? `${paragraph} ${plain}` : (flush(), plain);
    open = line.trim().length >= WRAPPED_LINE_CHARS && !/[.!?:"”'’)\]]$/.test(plain);
  }
  flush();
  return blocks.flatMap(splitSentences);
}

// --- Finding names and cutting quotations --------------------------------------------------------

export type Found = { sentence: string; start: number; end: number };

/** Where the page names `name`: the first sentence with a funding word that names it, else the
 *  first sentence that names it at all. Null when no sentence does. */
export function findInPage(sentences: string[], name: string): Found | null {
  const m = matcherFor(name);
  if (m === null) return null;
  let first: Found | null = null;
  for (const sentence of sentences) {
    const hit = findName(sentence, m);
    if (hit === null) continue;
    const found = { sentence, ...hit };
    if (hasFundingWord(sentence)) return found;
    first ??= found;
  }
  return first;
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
export function quoteFor(sentences: string[], name: string): string | null {
  const found = findInPage(sentences, name);
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

  const sentences = sentencesOf(page.text, page.title ?? null);
  if (findInPage(sentences, f.name) === null) return { status: "set_apart", reason: "company_not_named", investors: unnamed(f) };

  const investors: CheckedInvestor[] = listedInvestors(f).map((i) => {
    const quote = quoteFor(sentences, i.name);
    return { ...i, named: quote !== null, quote };
  });
  if (!investors.some((i) => i.named)) return { status: "set_apart", reason: "no_investor_named", investors };

  const partner = f.leadPartner !== null && findInPage(sentences, f.leadPartner) !== null ? f.leadPartner : null;
  const founders = splitNames(f.founders).filter((n) => findInPage(sentences, n) !== null);
  return { status: "proved", stage: stageOfRound(f.roundType)!, investors, partner, founders };
}
