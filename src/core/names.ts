// Names of companies, investors and people: how a cell is split into names, how two spellings are
// found to be the same name, and how a name is found in a page's sentence.

/** Words that say what kind of company it is, not which one. Dropped before names are compared. */
const LEGAL_WORDS = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "gmbh", "lp", "llp", "plc", "corp", "corporation",
  "sa", "sas", "sarl", "srl", "bv", "nv", "ag", "pte", "pty",
]);

/** Lowercase, accents and punctuation gone, words separated by one space. */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The words a name is compared by: normalised, with the legal words dropped. */
export function nameWords(name: string): string[] {
  return normalize(name)
    .split(" ")
    .filter((w) => w !== "" && !LEGAL_WORDS.has(w));
}

/** The key two spellings of one name share ("Copperline Ventures, LLC" and "Copperline Ventures"). */
export function nameKey(name: string): string {
  return nameWords(name).join(" ");
}

/** Entries in an investor cell that name nobody: "angel investors", "a group of angel investors",
 *  "existing investors", "others", "undisclosed". They are never investors. */
const GENERIC = new RegExp(
  "^(?:and )?(?:a |an |the )?(?:(?:group|number|couple|handful|host|range|syndicate) of )?" +
    "(?:(?:several|various|other|others|some|few|many|multiple|existing|new|previous|returning|strategic|individual|private|" +
    "undisclosed|unnamed|unknown|notable|prominent|high profile|well known|angel|business|local|international|" +
    "institutional|family|additional|follow on|early|seed|tech|industry) )*" +
    "(?:investors?|angels?|backers?|others|individuals|offices?|family offices?|vcs?|participants|" +
    "undisclosed(?: .*)?|unknown)$",
);

export function isGeneric(name: string): boolean {
  const n = normalize(name);
  return n === "" || n === "null" || n === "none" || n === "n a" || GENERIC.test(n);
}

/**
 * Splits a cell of names. Real cells mix separators ("A, B; C"), add notes in brackets
 * ("A (lead)"), and end with "and" ("A, B and C"). A comma inside brackets does not split.
 * Generic entries and empty ones are dropped; a name listed twice is kept once.
 */
export function splitNames(cell: unknown): string[] {
  if (typeof cell !== "string") return [];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of cell) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ";" || ch === "," || ch === "\n")) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const name = raw
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/^\s*(?:and|&)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[\s.\-–—:]+|[\s\-–—:]+$/g, "");
    if (name === "" || isGeneric(name)) continue;
    const key = nameKey(name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** A URL-safe slug for a name ("Copperline Ventures" -> "copperline-ventures"). */
export function slugOf(name: string): string {
  const s = normalize(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s === "" ? "investor" : s.slice(0, 60).replace(/-+$/, "");
}

// --- Finding a name in a sentence ---------------------------------------------------------------

/** Words that make a sentence about money raised. A one-word name counts only in such a sentence.
 *  Beside led, participation, investors, backed, joined, round and funding: the forms of "raise"
 *  and "invest", and the names of the stages, which a headline such as "Kettle raises $4M seed" uses. */
const FUNDING_WORDS =
  /(?<![\p{L}\p{N}])(?:led|leads|co-led|colead|participation|participated|participating|investors?|investment|invested|investing|backed|backing|joined|round|rounds|funding|financing|raise|raises|raised|raising|seed|pre-seed|series)(?![\p{L}\p{N}])/iu;

export function hasFundingWord(sentence: string): boolean {
  return FUNDING_WORDS.test(sentence);
}

/** The text with accents removed, character for character, so positions in it are positions in
 *  the original. A character that does not fold to one of the same length is kept as it is. */
export function foldAccents(text: string): string {
  let out = "";
  for (const ch of text) {
    const f = ch.normalize("NFD").replace(/\p{M}/gu, "");
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type NameMatcher = {
  name: string;
  words: string[];
  /** One word after the legal words are dropped: such a name needs its capital letter and a
   *  funding sentence. */
  oneWord: boolean;
};

export function matcherFor(name: string): NameMatcher | null {
  const words = nameWords(name);
  if (words.length === 0) return null;
  return { name, words, oneWord: words.length === 1 };
}

/**
 * Where the name is in the sentence, or null. Found as a whole name: its words in order, separated
 * only by spaces or punctuation, not inside a longer word, ignoring case and accents. A one-word
 * name (Headline, True, Neo; a company called Kettle) is also an ordinary word, so it counts only
 * written with a capital letter (in any case when the name itself is written without one) and
 * only in a sentence with a funding word.
 */
export function findName(sentence: string, m: NameMatcher): { start: number; end: number } | null {
  const folded = foldAccents(sentence);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${m.words.map(escapeRe).join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`, "giu");
  if (m.oneWord && !hasFundingWord(sentence)) return null;
  // A name written without a capital ("heytruffle") is a brand spelled that way: any case counts.
  const needsCapital = /\p{Lu}/u.test(m.name);
  for (let hit = re.exec(folded); hit !== null; hit = re.exec(folded)) {
    if (m.oneWord && needsCapital && !/\p{Lu}/u.test(hit[0])) continue;
    return { start: hit.index, end: hit.index + hit[0].length };
  }
  return null;
}
