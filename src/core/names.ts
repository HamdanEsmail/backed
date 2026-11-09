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
 *  "existing investors", "others", "entrepreneurs", "undisclosed", and "angel investors from
 *  Anthropic", which names an employer, not an investor. They are never investors. */
const GENERIC_HEAD =
  "^(?:and )?(?:a |an |the )?(?:(?:group|number|couple|handful|host|range|syndicate|network|collective) of )?" +
  "(?:(?:several|various|other|others|some|few|many|multiple|existing|new|previous|returning|strategic|individual|private|" +
  "undisclosed|unnamed|unknown|notable|prominent|high profile|well known|angel|business|local|international|" +
  "institutional|family|additional|follow on|early|stage|seed|tech|industry|ecosystem|experienced|senior|leading|" +
  "global|regional|serial|super) )*" +
  "(?:investors?|angels?|backers?|others|individuals|offices?|family offices?|vcs?|participants|entrepreneurs|" +
  "operators|founders|executives|leaders|advisors|advisers|mentors|friends|employees|alumni|insiders|" +
  "undisclosed(?: .*)?|unknown)";
const GENERIC = new RegExp(`${GENERIC_HEAD}$`);
/** "angel investors from Anthropic", "executives at …", "founders of …", "angels including …". */
const GENERIC_FROM = new RegExp(`${GENERIC_HEAD} (?:from|at|of|including|such as|across) `);

export function isGeneric(name: string): boolean {
  const n = normalize(name);
  return n === "" || n === "null" || n === "none" || n === "n a" || GENERIC.test(n) || GENERIC_FROM.test(n);
}

/**
 * Splits a cell of names. Real cells mix separators ("A, B; C"), add notes in brackets
 * ("A (lead)"), and end with "and" ("A, B and C"). A comma inside brackets does not split.
 * Generic entries and empty ones are dropped; a name listed twice is kept once. After "angel
 * investors from A, B, C" the rest of that list, up to the next semicolon, names their employers,
 * not investors, and is dropped too.
 */
export function splitNames(cell: unknown): string[] {
  if (typeof cell !== "string") return [];
  const parts: { text: string; afterComma: boolean }[] = [];
  let depth = 0;
  let current = "";
  let afterComma = false;
  for (const ch of cell) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ";" || ch === "," || ch === "\n")) {
      parts.push({ text: current, afterComma });
      current = "";
      afterComma = ch === ",";
    } else current += ch;
  }
  parts.push({ text: current, afterComma });
  const out: string[] = [];
  const seen = new Set<string>();
  let employers = false;
  for (const { text: raw, afterComma: listed } of parts) {
    if (!listed) employers = false;
    if (employers) continue;
    if (GENERIC_FROM.test(normalize(raw))) {
      employers = true;
      continue;
    }
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

/**
 * Words that make a sentence about money raised. A one-word investor counts only in such a
 * sentence. Beside led, participation, investors, backed, joined, round and funding: the forms of
 * "raise" and "invest", and the stages in their funding forms only ("seed round", "Series A"), so a
 * sentence about planting seed or a TV series is not one.
 */
const FUNDING_WORDS = new RegExp(
  "(?<![\\p{L}\\p{N}])(?:" +
    [
      "led", "leads", "co-led", "colead", "participation", "participated", "participating",
      "investors?", "investment", "invested", "investing", "backed", "backing", "joined",
      "round", "rounds", "funding", "financing", "raise", "raises", "raised", "raising",
      "pre-seed", "seed[- ](?:rounds?|funding|financing|investment|stage)", "series[- ][a-d]",
    ].join("|") +
    ")(?![\\p{L}\\p{N}])",
  "iu",
);

export function hasFundingWord(sentence: string): boolean {
  return FUNDING_WORDS.test(sentence);
}

/** The text with accents removed, character for character, so positions in it are positions in
 *  the original. A character that does not fold to one of the same length is kept as it is. */
export function foldAccents(text: string): string {
  // Most text is plain ASCII, which has no accents to fold.
  if (/^[\x00-\x7f]*$/.test(text)) return text;
  let out = "";
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x80) {
      out += ch;
      continue;
    }
    const f = ch.normalize("NFD").replace(/\p{M}/gu, "");
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

/** Where on the page a sentence stands: the page's title, a heading, or running text. */
export type SentenceKind = "title" | "heading" | "text";

/** A sentence prepared once, then searched for every name. */
export type Sentence = { text: string; folded: string; funding: boolean; kind: SentenceKind };

export function prepareSentence(text: string, kind: SentenceKind = "text"): Sentence {
  return { text, folded: foldAccents(text), funding: hasFundingWord(text), kind };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type NameMatcher = {
  name: string;
  words: string[];
  /** One word after the legal words are dropped: such a name is also an ordinary word. */
  oneWord: boolean;
  /** Written with a capital: then only a capitalised occurrence counts as a one-word name. */
  needsCapital: boolean;
  pattern: RegExp;
};

/** The name prepared once: its words and its pattern. Null for a name with no words left. */
export function matcherFor(name: string): NameMatcher | null {
  const known = matchers.get(name);
  if (known !== undefined) return known;
  if (matchers.size >= MATCHERS_KEPT) matchers.clear();
  const m = buildMatcher(name);
  matchers.set(name, m);
  return m;
}

/** Patterns already compiled in this isolate: a page names the same investors many times, and so
 *  do the pages after it. */
const matchers = new Map<string, NameMatcher | null>();
const MATCHERS_KEPT = 5000;

function buildMatcher(name: string): NameMatcher | null {
  const words = nameWords(name);
  if (words.length === 0) return null;
  return {
    name,
    words,
    oneWord: words.length === 1,
    needsCapital: /\p{Lu}/u.test(name),
    // Words may also run together: pages write "DayOne Capital" for Day One Capital.
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escapeRe).join("[^\\p{L}\\p{N}]*")}(?![\\p{L}\\p{N}])`, "giu"),
  };
}

export type Hit = { start: number; end: number };

/**
 * Every place the name stands in the sentence as a whole name: its words in order, separated only
 * by spaces or punctuation, not inside a longer word, ignoring case and accents. A one-word name
 * written with a capital counts only where the page writes it with one (a name written without one,
 * such as "heytruffle", in any case).
 */
export function nameHits(sentence: Sentence, m: NameMatcher): Hit[] {
  const hits: Hit[] = [];
  m.pattern.lastIndex = 0;
  for (let hit = m.pattern.exec(sentence.folded); hit !== null; hit = m.pattern.exec(sentence.folded)) {
    if (m.oneWord && m.needsCapital && !/\p{Lu}/u.test(hit[0])) continue;
    hits.push({ start: hit.index, end: hit.index + hit[0].length });
  }
  return hits;
}

/**
 * Where an investor's name is in the sentence, or null. A one-word name (Headline, True, Neo) is
 * also an ordinary word, so it counts only in a sentence with a funding word.
 */
export function findName(sentence: Sentence | string, m: NameMatcher): Hit | null {
  const s = typeof sentence === "string" ? prepareSentence(sentence) : sentence;
  if (m.oneWord && !s.funding) return null;
  return nameHits(s, m)[0] ?? null;
}

/** True when the hit is the first word of its sentence (only punctuation before it). */
export function startsSentence(sentence: Sentence, hit: Hit): boolean {
  return !/[\p{L}\p{N}]/u.test(sentence.text.slice(0, hit.start));
}
